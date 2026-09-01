// Server-side signer for Nomos's operating wallet — the account both
// payment flows settle into (see docs/ARCHITECTURE.md "Custody & signing").
// Software secp256k1 key today, explicit Turnkey stand-in.
//
// This module covers ordinary invokes only (the pattern proven by the
// wallet's own deploy-account transaction — see cairo/address.md). STRK20
// privacy actions (deposit/withdraw/transfer) go through a separate SDK
// (@starkware-libs/starknet-privacy-sdk) that needs a proving-service URL
// for Sepolia not yet resolved, plus the deposit-screening constraint
// documented in docs/ARCHITECTURE.md — that wiring is Phase 5/6's job, not
// this module's.
import { Account, EthSigner, type ProviderInterface } from "starknet";

// Keyed by network index, never a single slot. An Account binds the provider
// it was built with, so one shared instance would hand whichever network
// warmed the cache first to every caller afterwards — and with the console's
// test/live toggle both networks are live in one process. A mainnet payout
// signed against the Sepolia provider is the failure that buys, so the key is
// load-bearing rather than an optimisation.
const cache = new Map<number, Account>();

// The operating wallet as a plain starknet.js Account, for ordinary
// (non-privacy) invokes — e.g. the public leg of a Flow B settlement, or
// any contract call that doesn't need the privacy SDK's proving flow.
export function getOperatingAccount(provider: ProviderInterface, networkIndex: number): Account {
  const hit = cache.get(networkIndex);
  if (hit) return hit;
  const address = process.env.NOMOS_OPERATING_WALLET_ADDRESS;
  const privateKey = process.env.NOMOS_OPERATING_WALLET_PRIVKEY;
  if (!address || !privateKey) {
    throw new Error(
      "NOMOS_OPERATING_WALLET_ADDRESS / NOMOS_OPERATING_WALLET_PRIVKEY are not configured."
    );
  }
  const account = new Account({ provider, address, signer: new EthSigner(privateKey), cairoVersion: "1" });
  cache.set(networkIndex, account);
  return account;
}
