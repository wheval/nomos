# Nomos — Implementation Spec

Build order tracks the phases below. Each phase ends in a commit; CI must be green before moving to the next.

## Phase 0 — Spike: headless STRK20 signing

`scripts/spikes/headless-strk20.ts` (throwaway, not production code): given a raw secp256k1 key with a small amount of Sepolia STRK, attempt a `deposit` (shield) action via the `starkware-libs/starknet-privacy` SDK against its self-hostable prover. Record the outcome in `ARCHITECTURE.md`'s open-risk section — either the SDK path works and its API shape gets documented for Phase 3/5/6 to build against, or it doesn't and the headless-browser fallback is chosen instead.

## Phase 1 — Store abstraction

`src/server/store/`:
- `types.ts` — the `Store` interface and domain types (`Deposit`, `LedgerEntry`, `Payout`).
- `memoryStore.ts` — `Map`-based, default for tests/CI (`NOMOS_STORE_DRIVER=memory`).
- `fileStore.ts` — today's `.data/*.json` logic from `src/utils/store.ts`, adapted to the new interface.
- `supabaseStore.ts` — `@supabase/supabase-js`-backed; only instantiated when `NOMOS_STORE_DRIVER=supabase` and `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are present.
- `index.ts` — driver selection via `NOMOS_STORE_DRIVER` (`memory` in CI, `file` for local dev by default, `supabase` once credentials exist).

`supabase/migrations/0001_init.sql`:

```sql
create table merchants (
  address text primary key,
  public_key text unique not null,
  secret_key_hash text not null,
  webhook_url text,
  created_at timestamptz not null default now()
);

create table deposits (
  id uuid primary key default gen_random_uuid(),
  merchant_address text not null references merchants(address),
  flow text not null check (flow in ('A','B')),
  tx_hash text not null unique,
  amount_wei numeric(78,0) not null,
  token text not null default 'STRK',
  note text, ref text,
  status text not null default 'pending_verify'
    check (status in ('pending_verify','verified','pending_shield','shielded','shield_failed','rejected')),
  shield_tx_hash text,
  recorded_at timestamptz not null default now()
);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  merchant_address text not null references merchants(address),
  destination text not null,
  amount_wei numeric(78,0) not null,
  mode text not null check (mode in ('withdraw','transfer')),
  status text not null default 'pending' check (status in ('pending','broadcasting','confirmed','failed')),
  tx_hash text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  merchant_address text not null references merchants(address),
  direction text not null check (direction in ('credit','debit')),
  amount_wei numeric(78,0) not null,
  kind text not null check (kind in ('flow_a_deposit','flow_b_deposit','payout')),
  deposit_id uuid references deposits(id),
  payout_id uuid references payouts(id),
  running_balance_wei numeric(78,0) not null,
  created_at timestamptz not null default now()
);
```

Note `numeric(78,0)` throughout, not float — wei amounts must never lose precision.

`Store` interface (method shape):

```ts
recordDeposit(input): Promise<{deposit: Deposit; alreadyExisted: boolean}>; // idempotent on tx_hash
getDepositByTxHash(txHash): Promise<Deposit | null>;
markDepositShielded(depositId, shieldTxHash): Promise<void>;
listPendingShieldDeposits(): Promise<Deposit[]>;
creditLedger(input: {merchantAddress; amountWei; kind; depositId?}): Promise<LedgerEntry>;
debitLedger(input: {merchantAddress; amountWei; kind; payoutId?}): Promise<LedgerEntry>; // throws InsufficientBalanceError
getLedgerBalance(merchantAddress): Promise<bigint>;
createPayout(input): Promise<Payout>;
updatePayoutStatus(payoutId, status, txHash?): Promise<void>;
// existing surface, unchanged: issueMerchantKey / verifyMerchantSecret / webhook get-set
```

Test: `store.contract.test.ts` — takes any `Store` instance, asserts idempotent deposit recording, no-negative-balance debit, running-balance correctness. Run against `memoryStore` in CI; `supabaseStore.test.ts` self-skips when credentials aren't present.

## Phase 2 — On-chain tx verification

`src/utils/verifyTx.ts`:
- **Flow B**: fetch the receipt, require success, decode the `Transfer` event on `addrSTRK`, confirm `to === operatingWalletAddress` and `amount >= claimedAmount`.
- **Flow A**: public receipt data can't show amount/recipient (private transfers hide both by design). Verification instead means checking the operating wallet's *own* shielded balance/note discovery via the Phase 0 SDK for a note matching the claim — not reading calldata.

`POST /api/payments` body: `{ flow: "A"|"B", merchantAddress, amountWei, txHash, note?, ref? }`. Server verifies per-flow, calls `recordDeposit` (idempotent on `txHash`). Flow A credits the ledger immediately (funds are already shielded). Flow B leaves the deposit `pending_shield` until Phase 5's worker confirms shielding, then credits.

`GET /api/payments` reads from the ledger/deposits store, not the old flat `payments.json`.

Test: `verifyTx.test.ts` against mocked/fixture receipts — no live RPC calls in CI.

## Phase 3 — Operating wallet

Generate via `mcp__OpenZeppelinCairoContracts__cairo-account` with `type: "eth"`. Deploy on Sepolia. `scripts/deploy-operating-wallet.ts` precomputes and prints the address *before* broadcasting, so it can be faucet-funded first.

`src/server/signer/operatingWallet.ts` wraps:
- A plain `starknet.js` `Account` for ordinary invokes.
- The Phase 0-resolved client for STRK20 actions (`deposit`/`withdraw`/`transfer`).

New env vars (`.env.example` only, placeholders — never commit real values): `NOMOS_OPERATING_WALLET_ADDRESS`, `NOMOS_OPERATING_WALLET_PRIVKEY` (comment: software key, explicit Turnkey stand-in), `NOMOS_STORE_DRIVER`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NOMOS_SHIELD_WORKER_SECRET`.

## Phase 4 — Checkout split

`Checkout.tsx` state machine: `idle → picking-flow → connecting-wallet → awaiting-signature → submitting → confirming → recording → paid | error`.

- **Flow A** ("Pay privately"): existing private-transfer code path, `recipient` changed from the merchant's address to `operatingWalletAddress`; `merchantAddress` (the link's original `to`) carried separately in the `/api/payments` POST body.
- **Flow B** ("Pay with any wallet"): a plain ERC-20 `transfer` invoke on `addrSTRK` to the operating wallet address — no STRK20 wallet-standard features required.

`SelectWallet.tsx`: remove `!id.includes("braavos")` from the picker filter (keep the MetaMask exclusion — unrelated Snap-probe issue). Privacy-only UI (the Shield/Send/Unshield/Echo tabs in `WalletAccountV6Tag.tsx`, and the Flow A checkout option) gates on wallet *capability* (attempt `strk20Balances` / check `supportedSpecs`), not connect-time exclusion.

## Phase 5 — Shield-step worker

STRK20 proving is slow (existing code already budgets `retries: 400 × 3000ms`) — shielding can't run inline in a serverless request.

`src/app/api/internal/shield-worker/route.ts` (protected by a `NOMOS_SHIELD_WORKER_SECRET` header): scans `listPendingShieldDeposits()`, shields each via the Phase 3 signer, marks `shielded` + credits the ledger on confirmation, or `shield_failed` (with a retry count) on failure. `vercel.json` gets a Cron entry to trigger it on an interval; a `yarn shield:worker` script allows manual triggering before Vercel Cron is live.

## Phase 6 — Payout

`src/app/api/payouts/route.ts`:
- `POST { merchantAddress, secretKey, destination, amountWei, mode }` — verify secret key, check ledger balance, debit, execute via the Phase 3 signer (`withdraw` for public, `transfer` for private).
- `GET` lists payout history for the merchant.

New `Payout.tsx` in the dashboard: balance display, destination + amount fields, public/private mode toggle.

## Phase 7 — README

Replace "Nomos never touches funds" with the real model: operating wallet holds the aggregate shielded balance; merchants hold a ledger claim, not an on-chain balance; software key today as an explicit Turnkey stand-in; Flow A is shielded end-to-end, Flow B's inbound leg is briefly public before the shield step.

## Phase 8 — Mainnet cutover (final pass only)

Redeploy the operating wallet contract on mainnet, flip `NOMOS_STORE_DRIVER`/provider index/env config, one smoke-test payment end-to-end, verify on Voyager, record the transaction/contract addresses in `strk20.json` for hackathon submission.

## CI

`.github/workflows/ci.yml`: install (`yarn install --frozen-lockfile`) → lint → typecheck (`tsc --noEmit`) → test (`vitest run`, `NOMOS_STORE_DRIVER=memory`) → build (`yarn build`). Triggers on push/PR to `main`. No step in this pipeline requires live Sepolia or Supabase credentials.
