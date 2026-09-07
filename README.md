# Nomos

[![CI](https://github.com/wheval/nomos/actions/workflows/ci.yml/badge.svg)](https://github.com/wheval/nomos/actions/workflows/ci.yml)

Take payments on Starknet without publishing your revenue.

Every stablecoin payment you accept today is public. Anyone with your address
can read what you charged and add it up. Nomos settles through the STRK20
privacy pool instead, so amounts, senders and your running total stay off the
public chain.

**Live on mainnet.** Six verified transactions against the live pool, listed in
[`strk20.json`](strk20.json) — payments and payouts. Try it:
[nomos-henna.vercel.app](https://nomos-henna.vercel.app)

## What you get

- **Payment Links** — send a link, get paid. No integration.
- **Invoices** — payable once, addressed to a customer.
- **Hosted checkout** — create a session from your backend, redirect, get them back.
- **API and webhooks** — verify a payment, read balances, trigger payouts.

Your customer pays either way:

- **Shielded wallet** (Ready, Braavos) — private end to end.
- **Any Starknet wallet** — the transfer is public, but who received it is not.
  Nomos shields it into your balance.

## The hard part

A shielded transfer publishes nothing. No sender, no amount, no memo. So a
gateway can't watch the chain for "did anyone pay me?" — there's no event.

Nomos reserves the amount before the customer pays. A note arriving for
exactly that amount names exactly one payment. Attribution becomes a lookup.

Two consequences:

- When the wallet returns a transaction hash, we verify it and settle in
  seconds.
- When it doesn't — tab closed, wallet never came back — the amount still
  identifies the note, and the payment is credited anyway.

That second one is why a payment can't be lost by closing a tab. Details in
[`docs/flows`](https://nomos-henna.vercel.app/docs/flows).

## Custody, stated plainly

Nomos holds funds between the payment and your payout, like any processor.
Your balance is a ledger claim, not an on-chain account you control. That's a
deliberate trade: an ordinary wallet's payment has to land somewhere before it
can be shielded, so a pure non-custodial router can't serve those customers at
all.

Payments are private **from the chain**, not from Nomos. See
[Disclosure](https://nomos-henna.vercel.app/docs/disclosure) for what can be
proved to whom.

The operating wallet signs with a software secp256k1 key — a stand-in for real
key management (Turnkey/KMS), not the end state. Deployed and registered on
mainnet and Sepolia; addresses in [`cairo/address.md`](cairo/address.md).

## Pricing

A flat fee per transaction, never a percentage — because the pool underneath is
flat too. STRK20 charges one fee per action regardless of size, so a percentage
on top would throw away the reason a large private payment is viable here at
all (shielding $100k costs 0.25% on Railgun and cents on Starknet).

| | Fee |
| --- | --- |
| Private payment (Flow A) | 0.01 USDC / 0.4 STRK |
| Public payment (Flow B) — Nomos shields it for you | 0.02 USDC / 0.8 STRK |
| Payout | 0.05 USDC / 2 STRK |

Prototype pricing: set well below what the model implies so testing does not
need real money, and the payout fee does not yet cover on-chain settlement.

Fees come out of settlement: the deposit records the gross, the ledger is
credited the net. The schedule lives in [`src/utils/fees.ts`](src/utils/fees.ts)
and its tests assert the economics — that a payout fee covers the on-chain cost
of a payout — not just the constants. Minimum payouts exist so settlements
batch; a payout costs the same ~9.5 STRK whether it settles one payment or
fifty.

## Networks

Both networks are live. The operating wallet is deployed and registered on
the pool on each, and payments and payouts have settled on both.

```bash
set -a; source .env.local; set +a
npm run setup:sepolia          # readiness check: config, class, account, balance, registration
npm run setup:mainnet          # same, for mainnet
npm run setup:mainnet -- --apply   # declare + deploy (refuses to spend below a funding floor)
```

Registration is a separate step, behind `POST /api/internal/register
{"networkIndex": 0}` — it runs through the real per-network wiring, because
mainnet proving goes through the [Starkscan relay](https://starkscan.co/docs/api/strk20-prover)
(an async job API behind `STARKSCAN_API_KEY`, mainnet-only) while Sepolia uses
StarkWare's synchronous JSON-RPC prover. The SDK's own proof provider only
speaks the latter, so `src/server/signer/starkscanProver.ts` implements the
former.

## Quick start

```bash
npm install
cp .env.example .env.local     # add your Alchemy key + the other values below
npm run dev                    # http://localhost:3000
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

`npm run lint` / `npm run typecheck` / `npm test` / `npm run build` — all four run in GitHub Actions on every push/PR against `main`, using the in-memory store driver (no external credentials needed for CI to pass).

## Deploy

Standard Next.js on [Vercel](https://vercel.com/new). Set every variable in `.env.example` — in particular `NOMOS_STORE_DRIVER=supabase` with real Supabase credentials, since the file-based store doesn't survive Vercel's serverless filesystem.

## Docs

Published docs live at `/docs` in the app itself (fumadocs, source in
[`content/docs`](content/docs)) — quickstart, payment links, flows, privacy,
pricing, API, webhooks, limits.

Design notes: [`docs/PRD.md`](docs/PRD.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)

## Links

[STRK20 by example](https://strk20.starknet.io/docs) · [Privacy SDK](https://github.com/starkware-libs/starknet-privacy) · [WalletAccount guide](https://starknet-js.com/docs/next/guides/account/walletAccount/#with-get-starknet-v6)

Bootstrapped from the official [STRK20 starter kit](https://github.com/Akashneelesh/strk20-starter-kit), in turn from [PhilippeR26/Starknet-WalletAccount](https://github.com/PhilippeR26/Starknet-WalletAccount).
