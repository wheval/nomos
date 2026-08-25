# Nomos

A private payment gateway for Starknet, built for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon). A business drops in a Payment Link or checkout widget; a customer pays two ways — with a shielded wallet (fully private end to end) or an ordinary Starknet wallet (the payment itself is public, but which business it went to stays private); settlement clears as real transactions against the live STRK20 pool.

## The trust model, plainly

Nomos is **custodial, not a pure router**. Both payment flows settle into Nomos's own operating wallet first; a merchant's balance is an internal ledger claim, not an on-chain account they hold directly, and they cash out via a payout whenever they choose (publicly, or privately if they have their own shielded wallet). This is a deliberate trade, not an oversight — see [`docs/PRD.md`](docs/PRD.md) for why (short version: an ordinary wallet's payment has to land somewhere before it can be shielded, so a pure non-custodial router can't serve those customers at all) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full custody/signing model, including exactly what's private and what isn't for each flow.

The operating wallet signs with a software secp256k1 key today — an explicit stand-in for real key-management infra (Turnkey/KMS), not the intended end state. It's deployed on Sepolia; see [`cairo/address.md`](cairo/address.md) for the address and class hash.

## Quick start

```bash
yarn install
cp .env.example .env.local     # add your Alchemy key + the other values below
yarn dev                       # http://localhost:3000
```

Needs a free [Alchemy](https://alchemy.com) Starknet RPC key. `.env.example` documents every variable — the ledger store defaults to a local JSON-file driver (`NOMOS_STORE_DRIVER=file`), fine for local dev; a real deployment needs `NOMOS_STORE_DRIVER=supabase` and a Supabase project (schema in `supabase/migrations/0001_init.sql`).

## What's inside

- **Connect** — `get-starknet` v6 discovery + wallet picker, with `eip1193Adapters: []` to stop MetaMask popups → `SelectWallet.tsx`. Any wallet works now (Braavos included) — only the private-payment flow needs a shielded-capable one.
- **Checkout** — the customer-facing flow split (shielded transfer, or a plain transfer from any wallet), both settling into the operating wallet → `Checkout.tsx`
- **Ledger** — deposits, credits/debits, payouts; one `Store` interface with memory/file/Supabase implementations → `src/server/store/`
- **Verification** — on-chain confirmation before crediting anything, per flow → `src/utils/verifyTx.ts`
- **Dashboard** — API keys, webhook config, deposit history, balance, payout → `Dashboard.tsx`, `Payout.tsx`
- **Shield reconciliation** — deposits into the pool need FPI screening with no headless workaround (see `docs/ARCHITECTURE.md`), so shielding a plain-wallet payment is a manual, team-operated step; `/api/internal/shield` + `scripts/shield-reconcile.ts` handle the bookkeeping around it
- **Operating wallet** — an OpenZeppelin `eth`-type (secp256k1) Starknet account → `cairo/src/operating_wallet.cairo`, signer wrapper in `src/server/signer/`
- **Anonymizer** — a minimal `privacy_invoke` demo contract, not part of the payment flow, kept as an integration reference → `cairo/src/lib.cairo`

Stack: Next.js 16 · React 19 · TypeScript · starknet.js 10 · zustand · vitest. No component framework.

## Gotchas worth knowing

- **Placeholders are literal strings.** In the `invoke` action (the anonymizer demo panel), `"OPEN"`, `"${poolAddress}"`, `"${openNoteIds[0]}"` are substituted by the wallet — never `num.toHex` them. Only real token/amounts get hex-normalized.
- The echo helper (`WalletAccountV6Tag.tsx`) is a **no-op demo**, not part of the product flow — kept as an integration reference for anyone checking the wallet-toolkit wiring itself.
- Deposits into the STRK20 pool need an FPI screening signature — self-hosting a prover doesn't bypass it. This is why shielding a plain-wallet payment isn't (yet) a fully automated background job; see `docs/ARCHITECTURE.md`.

## Testing & CI

`yarn lint` / `yarn typecheck` / `yarn test` / `yarn build` — all four run in GitHub Actions on every push/PR against `main`, using the in-memory store driver (no external credentials needed for CI to pass).

## Deploy

Standard Next.js on [Vercel](https://vercel.com/new). Set every variable in `.env.example` — in particular `NOMOS_STORE_DRIVER=supabase` with real Supabase credentials, since the file-based store doesn't survive Vercel's serverless filesystem.

## Docs

[`docs/PRD.md`](docs/PRD.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)

## Links

[STRK20 by example](https://strk20.starknet.io/docs) · [Privacy SDK](https://github.com/starkware-libs/starknet-privacy) · [WalletAccount guide](https://starknet-js.com/docs/next/guides/account/walletAccount/#with-get-starknet-v6)

Bootstrapped from the official [STRK20 starter kit](https://github.com/Akashneelesh/strk20-starter-kit), in turn from [PhilippeR26/Starknet-WalletAccount](https://github.com/PhilippeR26/Starknet-WalletAccount).
