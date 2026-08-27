# Nomos — Architecture

## System shape

```
Customer (shielded wallet)  ──private transfer──┐
                                                  ├──▶ Nomos operating wallet ──▶ internal ledger ──▶ payout ──▶ merchant's destination
Customer (ordinary wallet)  ──public transfer────┘         (shields it)
```

One operating wallet, controlled by Nomos, receives both flows. A ledger (not an on-chain account per merchant) tracks whose money is whose. A merchant only actually receives funds when they request a payout.

## Settlement tokens: STRK and USDC

STRK20 is a privacy *protocol*, not a token — every action (`deposit`, `transfer`, `withdraw`) takes an explicit `token` address, so any ERC-20 the pool has onboarded can be shielded. It launched STRK-only; USDC support went live June 25, 2026. A payment gateway checkout should default to a dollar-pegged stablecoin, not a token whose USD value moves under the merchant mid-settlement — so Nomos offers both, merchant picks per Payment Link, customer sees whichever the link specifies.

This makes the ledger balance **scoped to (merchant, token)** rather than a single aggregate — STRK and USDC are different assets with different decimals (18 vs 6), summing their wei together would be meaningless. `getLedgerBalance`/`creditLedger`/`debitLedger` all take a token; `GET /api/payments` returns a `balances: {STRK, USDC}` map, not one number. Token addresses and decimals are centralized in `src/utils/constants.ts`'s `Tokens` registry, sourced from `starknet-io/starknet-addresses` (the canonical registry), not hand-typed elsewhere.

## Why custodial, not a pure router

The original design routed private transfers directly wallet-to-wallet — Nomos never held funds, only recorded that a payment happened after the fact. That model can't serve Flow B customers at all: an ordinary wallet's plain transfer has to land *somewhere* before it can become a shielded balance, and the customer's wallet can't sign a compound "receive-then-shield" action itself. Once Flow B requires an intermediary hop regardless, running Flow A through the same intermediary (rather than half router, half custodian) is simpler to build, reason about, and secure — one trust model instead of two.

This mirrors how real custodial payment infrastructure already works — e.g. Blockradar's dedicated-deposit-address-then-sweep-to-master-wallet pattern for stablecoin fintechs — except Nomos deliberately avoids per-merchant dedicated *deposit* addresses, because that pattern (fine for Blockradar, which has no privacy goal) would publicly link a customer's payment to a specific merchant here, which is exactly what Nomos exists to prevent.

## What's actually private, and what isn't

Confirmed against STRK20's own documentation: private transfers reveal neither sender, receiver, nor amount by default — that's a ZK-proof-backed protocol guarantee, not a policy Nomos chooses to honor.

- **Flow A**: fully private end to end. Nomos, as recipient, cannot see who sent it.
- **Flow B**: the customer's own deposit *is* public (amount + the fact they paid Nomos, visible to anyone). What's still hidden: which merchant they paid, and what that merchant does with its balance — because the merchant-facing side of the ledger has no on-chain trace at all (it's an off-chain ledger entry against an aggregate shielded balance nobody outside Nomos can even see the total of).
- Unbatched shielding does not undermine the above — it only means an observer watching Nomos's own account history directly could correlate timing/amount between a specific public deposit and a specific shield action. That's metadata leakage about Nomos's operations over time, not a break of the merchant-privacy guarantee. Worth hardening later (batched/delayed shielding); not required for this build.

## Custody & signing

The operating wallet is a Starknet account contract — Starknet's native account abstraction means signature *verification* is programmable, not fixed to the native Stark curve. It's deployed as an OpenZeppelin Cairo `eth`-type account, which verifies **secp256k1** signatures instead. That matters because secp256k1 is what standard key-management infrastructure (Turnkey, AWS KMS's `ECC_SECG_P256K1`) already supports — the Stark curve isn't supported by that class of tooling.

For this build: the operating wallet's key is a **local software secp256k1 key**, held server-side (never in `NEXT_PUBLIC_*`, never returned by any API response). This is explicitly a stand-in for Turnkey — the eventual production answer — not the final security posture. Anyone who wants to see this decision's full reasoning should read the design conversation this doc was extracted from; the short version is: Turnkey integration is real, useful, and deliberately deferred so the first working end-to-end demo isn't blocked on an external account signup.

### Signing surface — narrower than "custodial" sounds

The operating wallet only ever signs two kinds of operations:
1. **Shield** a confirmed Flow B deposit into the pool.
2. **Payout** — withdraw (public) or transfer (private) funds out, merchant-initiated.

It never signs on behalf of a customer, and never holds a customer's key at any point in either flow.

## Resolved risk: headless STRK20 signing

Verified directly against `node_modules/starknet/dist/index.d.ts`: `strk20InvokeTransaction`, `strk20PrepareInvoke`, and `strk20Balances` are all typed to take a `WalletWithStarknetFeatures` — a real wallet-extension object (Ready, etc.) — not a raw `Account`/private key. **There is no headless path to STRK20 actions inside starknet.js itself.** That part of the original concern stands.

But starknet.js was never the right layer to look at — the actual privacy *protocol* SDK is a separate package, and it's headless by design. Confirmed directly against the official docs (strk20.starknet.io/docs/sdk/getting-started), it **is** on public npm: `npm install @starkware-libs/starknet-privacy-sdk` (the fork's earlier finding that it wasn't publicly published is superseded by this — install it plainly, no git-commit-sha workaround needed). `createPrivateTransfers({ account, viewingKeyProvider, provingProvider, discoveryProvider, poolContractAddress })` takes a plain starknet.js `Account` built from a raw private key (`cairoVersion: "1"` required) — no wallet extension anywhere in the picture. A fluent builder then exposes exactly the operations Nomos needs: `.register()`, `.deposit(...)`, `.withdraw(...)`, `.transfer(...)`. For discovery, `ContractDiscoveryProvider` (direct RPC, no extra infra) is the documented development option — exactly what Sepolia dev/testing needs; `IndexerDiscoveryProvider` (hosted HTTP service, needs `INDEXER_URL`) is the production option.

**Verified with a real spike**, not just documentation reading: `scripts/spikes/headless-strk20.ts` (run against the SDK's own `Mocknet` in-memory test harness — an in-memory pool contract + mock prover + mock discovery, zero external infra needed) confirms a raw address+private-key signer can headlessly `deposit` (shield) and `withdraw` (public unshield) STRK20 funds — precisely the two operations Phase 5's shield-step worker and Phase 6's public-payout mode need. Output: shielded note created, public balance debited/credited correctly on both operations, no wallet extension involved at any point.

One caveat surfaced by the spike, not a blocker: firing a private `transfer` (Phase 6's *private*-payout mode) immediately after another private operation on the same registry hit a "Nullifier already exists" error from the mock prover. This matches a rule the SDK's own README documents explicitly ("Sequencing private transactions" — the prover reads finalized state, so back-to-back private operations need the previous transaction's block to finalize first, with a documented polling recipe). Not a headless-signing problem — deposit and withdraw already prove that works — just a real sequencing constraint Phase 6's private-transfer payout path needs to implement (poll for block finality between operations) rather than fire actions back-to-back.

**Status: headless signing itself is resolved. Flow B's shield step specifically is not — see the deposit-screening constraint below, which changes Phase 5's design.**

### Resolved: proving service, and a real gas-cost surprise

The proving-service blocker (this doc previously flagged self-hosting the prover as a multi-service, 48-vCPU-class undertaking) turned out to only apply to one narrow case. Per the STRK20 team directly (Cairo CoreStars Telegram) and confirmed against `strk20-starter-kit`'s own README: **a self-hosted prover is only needed for a wallet flow that doesn't go through Ready or Xverse.** Any action driven by a real wallet extension — a customer's Flow A payment, a team member manually shielding a Flow B deposit — never touches a prover at all; the wallet generates its own proof. The only place Nomos's own code needs one is the operating wallet's headless SDK calls (`register`, `transfer`, `withdraw`), since there's no wallet extension in that path. The Starknet team provided a Sepolia proving URL directly for this hackathon (`PROVING_SERVICE_URL`, kept out of the repo — see `.env.example`).

With that unblocked, `src/server/signer/privacyClient.ts` wires the real SDK (`@starkware-libs/starknet-privacy-sdk`, installed via GitHub Packages — needs a personal GitHub token with `read:packages` scope in a local `.npmrc`, not committed) against the real Sepolia pool (`0x0254a6...cfe0d91`, confirmed independently via Sepolia Voyager as "Starknet: Canonical Privacy Pool"). `noteDiscovery.ts` (Flow A verification) and `payoutExecutor.ts` (payouts) both build on it. The operating wallet is registered on the pool as of 2026-08-27 — see `cairo/address.md`.

**Real gas cost, discovered empirically, not estimated**: starknet.js's automatic fee estimation always simulates with `SKIP_VALIDATE`, so it never accounts for the operating wallet's own `__validate__` cost — and this wallet is an OZ **eth-type** account (secp256k1 signature verification, chosen for future Turnkey/AWS KMS compatibility), which is dramatically more expensive to validate on-chain than a native Stark-curve account. Confirmed directly against a real Sepolia transaction: a plain ERC20 `approve` needed ~40M L2 gas to pass validation (the estimator said ~2.1M); the `register()` call — larger, since it carries the STARK proof — needed 92.4M. `submitPrivateAction()` in `privacyClient.ts` now overrides `resourceBounds` manually rather than trusting the estimate. Practical consequence: **the operating wallet needs a healthy STRK balance to do anything** — each privacy-pool action costs a flat 2 STRK protocol fee (`get_fee_amount()` on the pool) *plus* real gas in the several-STRK range at current Sepolia prices. Fund it generously (20+ STRK), not just enough for one action.

### New constraint found: deposits are screened, self-hosting doesn't bypass it

Straight from the official docs (`docs/sdk/proving-config`): **every** deposit into the pool — regardless of proving backend, including a fully self-hosted prover — requires a screening signature from FPI (the pool's compliance screener), which the pool verifies on-chain. There is no configuration or self-hosting path around this; it's enforced at the contract level, not the proving service.

This directly affects Phase 5. The plan as designed had the operating wallet calling `deposit()` on confirmed Flow B funds itself — that call would need a screening signature Nomos has no way to obtain by itself. The docs state the intended workaround plainly: *"Teams running their own prover typically shield through a privacy-enabled wallet (Ready or Xverse) and then transfer privately to the account their integration controls."* In other words: the deposit/shield leg still needs an actual privacy-capable wallet (already screening-integrated) in the loop — headless signing covers `withdraw` and `transfer` cleanly (confirmed by the spike, and unaffected by this constraint, since screening is called out for deposits specifically), but not `deposit`.

**Decision for Phase 5**: shielding is a manual, team-operated step, not an automated background job. A team member shields pending Flow B deposits by hand through their own privacy-capable wallet (Ready/Xverse) and privately transfers the result into the operating wallet; `/api/internal/shield` + `scripts/shield-reconcile.ts` handle the bookkeeping (list what's pending, mark it done, credit the ledger, fire the webhook) once that's happened — see `IMPLEMENTATION.md` Phase 5. Right for 18 days at hackathon volume; not a real production answer. A question is out to the Cairo CoreStars Telegram asking whether FPI offers self-serve screening registration for automated integrators — if that resolves favorably, this phase gets revisited. Phase 6 (payout, via `withdraw`/`transfer`) is unaffected — screening is specific to deposits.

## Storage

Supabase (Postgres) backs the ledger, chosen over a simple key-value store because this is a financial ledger — it needs real transactions and an audit trail, not just gets/sets. A `Store` interface (`src/server/store/`) abstracts this: an in-memory implementation for tests/CI (no secrets required to run the suite), a file-based implementation (today's `.data/*.json` behavior, kept for convenient local dev, still not durable on Vercel), and the Supabase implementation for anything real. Driver selection is one env var (`NOMOS_STORE_DRIVER`).

Schema: `merchants`, `deposits` (idempotent on `tx_hash`, tracks `pending_verify → verified → pending_shield → shielded` for Flow B, `verified` immediately for Flow A), `ledger_entries` (credit/debit, running balance), `payouts`, `payment_links`. See `IMPLEMENTATION.md` for the actual DDL.

## Payment Links are persisted, not just URL params

Originally a Payment Link was purely client-side: the recipient, amount, and token lived in the `/pay` URL's query string, and the link *was* the record — nothing on the server had ever seen it. That meant the URL itself was the only source of truth a customer's browser had, and anyone could edit a copied link before forwarding it — change the amount, or worse, swap the recipient to their own address — with nothing to catch it.

Links are now created via `POST /api/payment-links` (authenticated with the merchant's own secret key — a link can only be created "as" the merchant who controls that key) and stored in Postgres. The shareable URL carries only an opaque id (`/pay?id=...`); the checkout page resolves it via `GET /api/payment-links/[id]` (public, unauthenticated — a Payment Link is inherently shareable, there's nothing secret in it) and renders whatever the server says, not whatever's in the URL. `POST /api/payments` — the route that actually credits a merchant's ledger after an on-chain payment — treats the link's stored `merchantAddress`/`token` as authoritative whenever a `linkId` is present, ignoring the client's own claims for those fields entirely. Revoked and expired links are rejected server-side before any on-chain verification runs, not just hidden in the UI.

## Sequencing: Sepolia first, mainnet last

The STRK20 privacy pool is live on both Mainnet (frontend provider index 0) and Sepolia (index 2) per `src/utils/constants.ts` — nothing about this build is mainnet-specific until the very last step. Build and test the entire flow on Sepolia, funded by free faucet STRK. Mainnet is a single cutover pass at the end: redeploy the operating wallet, flip config, one smoke-test transaction, done. This keeps real money out of the iterative development loop entirely.
