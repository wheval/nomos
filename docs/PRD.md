# Nomos — Product Requirements

## Problem

Nomos is a private payment gateway for Starknet, built for the STRK20 Private Sprint (18-day hackathon, submission requires a real transaction against the live STRK20 pool on **mainnet** — see `strk20.json` at the repo root, which the submission process expects filled in with transaction hashes, contract addresses, and demo links).

The original design assumed the customer paying a Payment Link already holds a shielded/privacy-capable wallet (Ready, or Argent/Braavos with Private Balances enabled) and sends a private STRK20 transfer straight to the merchant. That's a real adoption blocker: most customers of a business considering Nomos over a plain stablecoin gateway will not already have a privacy wallet. If Nomos can only serve customers who do, it loses to competitors on reach before privacy is ever a selling point.

## Solution

Nomos supports **two ways for a customer to pay**, both ending in the same place — a private balance the merchant controls the same way either way:

- **Flow A — customer already has a shielded wallet.** They send a private STRK20 transfer. Nothing about their identity or the amount is ever public.
- **Flow B — customer has an ordinary Starknet wallet.** They send a plain public transfer. Nomos shields it on their behalf before the merchant is credited. The customer's own payment is visible on-chain (that they paid, and how much) — but *who they paid* and *what that business does with its balance* stay private, because the merchant-facing leg is a private transfer regardless of which flow the customer used.

To make both flows land in the same place, Nomos becomes a light custodian: both flows route through Nomos's own operating wallet, and each merchant's balance is tracked as an internal ledger claim rather than an on-chain account. A merchant "cashes out" via a payout — sent either as a public unshield (e.g. to move to an exchange) or a private transfer (if the merchant has a privacy wallet themselves), merchant's choice, at withdrawal time.

This is a deliberate change from the original "Nomos never touches funds" framing. See `ARCHITECTURE.md` for the trust model this implies and why it's the right trade for this product.

## Non-goals for this build

- **Deposit batching.** Flow B's shield step happens per-deposit, not pooled with other pending deposits. The core privacy claim (merchant identity hidden) holds without batching, since STRK20 private transfers hide sender/receiver/amount by protocol default — batching would only harden against an observer correlating Nomos's *own* operational metadata over time, which is real future work, not required for this build.
- **Turnkey / real KMS integration.** The operating wallet signs with a local software secp256k1 key for this build, explicitly labeled in code and docs as a stand-in for Turnkey. Swapping in real Turnkey is a follow-up, not blocking the first working demo.
- **Per-merchant on-chain accounts or dedicated deposit addresses.** One shared operating wallet + one internal ledger. A dedicated address per merchant would leak which merchant a customer paid on the public Flow B leg — the opposite of the goal.

## Success criteria

1. Both flows work end-to-end on **Sepolia** first: a customer can pay via either path, the merchant's dashboard balance updates correctly, and the merchant can withdraw.
2. One real, verified transaction against the live STRK20 pool on **mainnet**, recorded for the hackathon submission (`strk20.json`: `transactions`, `contracts`, `demo_video`, `demo_url`).
3. CI (lint, typecheck, test, build) is green on every commit along the way — this repo currently has zero test infrastructure, so "green CI" is itself a new bar being introduced, not maintained.
4. The README accurately describes the real custody model — no claim in the docs should be untrue of the shipped code.
