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

## Open risk: headless STRK20 signing

Verified directly against `node_modules/starknet/dist/index.d.ts`: `strk20InvokeTransaction`, `strk20PrepareInvoke`, and `strk20Balances` are all typed to take a `WalletWithStarknetFeatures` — a real wallet-extension object (Ready, etc.) — not a raw `Account`/private key. **There is no headless path to STRK20 actions inside starknet.js itself.**

`WalletAccountV6` does expose `executeWithProof(calls, proof?: STRK20_PROOF)` — so if a `STRK20_PROOF` could be constructed off-wallet, the call itself is reachable. Building that proof is what StarkWare's separate `starkware-libs/starknet-privacy` repo is for (a `sdk/` TypeScript client plus a self-hostable prover Docker image), but its exact packaging and API shape weren't confirmed by research at planning time.

This directly affects the operating wallet's ability to shield deposits (Flow B) and execute payouts — both require STRK20 actions run *without* a browser wallet extension attached. This is being resolved as a time-boxed spike (`scripts/spikes/headless-strk20.ts`) before the rest of the signing implementation is locked in. If the SDK route doesn't pan out in the time available, the documented fallback is a headless browser session driving a real Ready extension — heavier, but real, and this doc will be updated with whichever path is actually taken once the spike concludes.

**Status: unresolved as of this doc's writing.** Treat anything in this build that depends on server-side STRK20 signing (the shield worker, payouts) as blocked on this spike's outcome.

## Storage

Supabase (Postgres) backs the ledger, chosen over a simple key-value store because this is a financial ledger — it needs real transactions and an audit trail, not just gets/sets. A `Store` interface (`src/server/store/`) abstracts this: an in-memory implementation for tests/CI (no secrets required to run the suite), a file-based implementation (today's `.data/*.json` behavior, kept for convenient local dev, still not durable on Vercel), and the Supabase implementation for anything real. Driver selection is one env var (`NOMOS_STORE_DRIVER`).

Schema: `merchants`, `deposits` (idempotent on `tx_hash`, tracks `pending_verify → verified → pending_shield → shielded` for Flow B, `verified` immediately for Flow A), `ledger_entries` (credit/debit, running balance), `payouts`. See `IMPLEMENTATION.md` for the actual DDL.

## Sequencing: Sepolia first, mainnet last

The STRK20 privacy pool is live on both Mainnet (frontend provider index 0) and Sepolia (index 2) per `src/utils/constants.ts` — nothing about this build is mainnet-specific until the very last step. Build and test the entire flow on Sepolia, funded by free faucet STRK. Mainnet is a single cutover pass at the end: redeploy the operating wallet, flip config, one smoke-test transaction, done. This keeps real money out of the iterative development loop entirely.
