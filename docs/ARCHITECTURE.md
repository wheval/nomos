# Nomos — Architecture

## System shape

```
Customer (shielded wallet)  ──private transfer──┐
                                                  ├──▶ Nomos operating wallet ──▶ internal ledger ──▶ payout ──▶ merchant's destination
Customer (ordinary wallet)  ──public transfer────┘         (shields it)
```

One operating wallet, controlled by Nomos, receives both flows. A ledger (not an on-chain account per merchant) tracks whose money is whose. A merchant only actually receives funds when they request a payout.

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

But starknet.js was never the right layer to look at — the actual privacy *protocol* SDK is a separate package, and it's headless by design. StarkWare's `starkware-libs/starknet-privacy` repo (cloned and inspected directly, not just read about) contains `sdk/`, published as `@starkware-libs/starknet-privacy-sdk` (not on public npm; install via `npm install "starkware-libs/starknet-privacy#<commit-sha>"` from a tagged release, or build from a clone's `sdk/` directory — `npm ci && npm run build` succeeds even without a local Cairo/scarb toolchain, since the generated ABI/hash artifacts the TS build depends on are already committed). Its `createPrivateTransfers({ account, viewingKeyProvider, provingProvider, discoveryProvider, poolContractAddress })` takes a plain `{ address, signer }` or a full starknet.js `Account` built from a raw private key — no wallet extension anywhere in the picture. A fluent builder then exposes exactly the operations Nomos needs: `.with(STRK, t => t.deposit({ amount }))`, `.withdraw(...)`, `.transfer(...)`.

**Verified with a real spike**, not just documentation reading: `scripts/spikes/headless-strk20.ts` (run against the SDK's own `Mocknet` in-memory test harness — an in-memory pool contract + mock prover + mock discovery, zero external infra needed) confirms a raw address+private-key signer can headlessly `deposit` (shield) and `withdraw` (public unshield) STRK20 funds — precisely the two operations Phase 5's shield-step worker and Phase 6's public-payout mode need. Output: shielded note created, public balance debited/credited correctly on both operations, no wallet extension involved at any point.

One caveat surfaced by the spike, not a blocker: firing a private `transfer` (Phase 6's *private*-payout mode) immediately after another private operation on the same registry hit a "Nullifier already exists" error from the mock prover. This matches a rule the SDK's own README documents explicitly ("Sequencing private transactions" — the prover reads finalized state, so back-to-back private operations need the previous transaction's block to finalize first, with a documented polling recipe). Not a headless-signing problem — deposit and withdraw already prove that works — just a real sequencing constraint Phase 6's private-transfer payout path needs to implement (poll for block finality between operations) rather than fire actions back-to-back.

**Status: resolved.** Phases 3/5/6 should build against `@starkware-libs/starknet-privacy-sdk`'s `createPrivateTransfers` + fluent builder, with a raw secp256k1-account-derived signer (matching the software-key decision above) as the `account` param, `ProvingServiceProofProvider`/`IndexerDiscoveryProvider` (or their mock equivalents in dev) as the providers, and the documented block-finality polling recipe wired into the private-transfer payout path specifically. Remaining follow-up, not blocking: pin an actual commit SHA for the git-based install once Phase 3 starts, and confirm whether a hosted Sepolia proving/discovery service exists (from STRK20 hackathon resources) or whether self-hosting the `ghcr.io/starkware-libs/starknet-privacy/transaction-prover` Docker image is required for Sepolia testing.

## Storage

Supabase (Postgres) backs the ledger, chosen over a simple key-value store because this is a financial ledger — it needs real transactions and an audit trail, not just gets/sets. A `Store` interface (`src/server/store/`) abstracts this: an in-memory implementation for tests/CI (no secrets required to run the suite), a file-based implementation (today's `.data/*.json` behavior, kept for convenient local dev, still not durable on Vercel), and the Supabase implementation for anything real. Driver selection is one env var (`NOMOS_STORE_DRIVER`).

Schema: `merchants`, `deposits` (idempotent on `tx_hash`, tracks `pending_verify → verified → pending_shield → shielded` for Flow B, `verified` immediately for Flow A), `ledger_entries` (credit/debit, running balance), `payouts`. See `IMPLEMENTATION.md` for the actual DDL.

## Sequencing: Sepolia first, mainnet last

The STRK20 privacy pool is live on both Mainnet (frontend provider index 0) and Sepolia (index 2) per `src/utils/constants.ts` — nothing about this build is mainnet-specific until the very last step. Build and test the entire flow on Sepolia, funded by free faucet STRK. Mainnet is a single cutover pass at the end: redeploy the operating wallet, flip config, one smoke-test transaction, done. This keeps real money out of the iterative development loop entirely.
