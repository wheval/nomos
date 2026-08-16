# Nomos

A private checkout gateway for Starknet, built for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon). A business drops in a Payment Link or checkout widget; a customer pays without their identity or the amount landing on a public ledger; settlement clears as a real transaction against the live STRK20 pool on mainnet.

Built on the official [STRK20 starter kit](https://github.com/Akashneelesh/strk20-starter-kit) — a lean Next.js base for privacy dApps on Starknet via [STRK20](https://eprint.iacr.org/2026/474) and `WalletAccountV6` (starknet.js v10): shield, unshield, private transfer, shielded balances, and an anonymizer (`privacy_invoke`) — all through the user's wallet, never a viewing key.

> Demo defaults (fixed token, fixed amounts, and an *echo* helper that just round-trips) are marked `DEMO` in the code — swap them for your own.

## Quick start

```bash
npm install
cp .env.example .env.local     # add your Alchemy key
npm run dev                    # http://localhost:3000
```

Needs a free [Alchemy](https://alchemy.com) Starknet RPC key and a privacy-enabled wallet (Ready) on Sepolia or Mainnet.

## What's inside

- **Connect** — `get-starknet` v6 discovery + wallet picker, with `eip1193Adapters: []` to stop MetaMask popups → `SelectWallet.tsx`
- **Actions** — shield / unshield / private transfer / echo / balances via `strk20InvokeTransaction` → `WalletAccountV6Tag.tsx`
- **Config** — token, RPC providers, helper addresses (all `DEMO`-labelled) → `src/utils/constants.ts`
- **Anonymizer** — a minimal `privacy_invoke` contract you can deploy from the UI → `cairo/src/lib.cairo`

Stack: Next.js 16 · React 19 · TypeScript · starknet.js 10 · zustand. No component framework.

## Gotchas worth knowing

- **Placeholders are literal strings.** In the `invoke` action, `"OPEN"`, `"${poolAddress}"`, `"${openNoteIds[0]}"` are substituted by the wallet — never `num.toHex` them. Only real token/amounts get hex-normalized.
- The echo helper is a **no-op demo** — replace its body with a real action (swap/vault/lend); the `privacy_invoke` shape stays the same. You own the tests and audit.
- Ready wallet works today (Xverse's Wallet API is landing); the app degrades gracefully for others.

## Deploy

Standard Next.js on [Vercel](https://vercel.com/new) — set `NEXT_PUBLIC_PROVIDER_URL` (and optionally `NEXT_PUBLIC_STRK20_ECHO_HELPER_SEPOLIA`).

## Links

[STRK20 by example](https://strk20-by-example.org/) · [Privacy SDK](https://github.com/starkware-libs/starknet-privacy) · [WalletAccount guide](https://starknet-js.com/docs/next/guides/account/walletAccount/#with-get-starknet-v6)

Bootstrapped from [PhilippeR26/Starknet-WalletAccount](https://github.com/PhilippeR26/Starknet-WalletAccount).
