// On-chain verification for both payment flows. Closes a real gap in the
// original /api/payments: it used to trust whatever {to, amount, txHash}
// the client POSTed, with no check that the transaction actually happened.
//
// Flow B (public transfer) and Flow A (private transfer) need genuinely
// different verification strategies — see docs/ARCHITECTURE.md "Resolved
// risk: headless STRK20 signing" for why Flow A can't be checked from
// public calldata.
import { hash, num, type ProviderInterface } from "starknet";
import { myFrontendProviders } from "./constants";

const TRANSFER_SELECTOR = num.toHex(hash.getSelectorFromName("Transfer"));

export type VerificationResult =
  | { ok: true; amountWei: bigint }
  | { ok: false; reason: string };

function providerForNetwork(networkIndex: number): ProviderInterface {
  const provider = myFrontendProviders[networkIndex];
  if (!provider) throw new Error(`No RPC provider configured for network index ${networkIndex}.`);
  return provider;
}

// Flow B: an ordinary public ERC-20 transfer, verified by decoding the
// Transfer event on the claimed token and confirming it paid the operating
// wallet at least the claimed amount.
//
// Two Transfer event shapes exist on Starknet and BOTH are in use by tokens
// we settle, so we have to accept either (verified against live chain data):
//
//   indexed (OZ Cairo ERC20) — Sepolia USDC, STRK on both networks
//     keys: [selector, from, to]   data: [value_low, value_high]
//
//   legacy (older ERC20s)    — Mainnet USDC
//     keys: [selector]             data: [from, to, value_low, value_high]
//
// Reading only the indexed shape silently rejects every Mainnet USDC
// payment: the transfer succeeds on-chain and the operating wallet receives
// the funds, but the deposit never gets credited to the merchant.
export async function verifyFlowBDeposit(params: {
  txHash: string;
  operatingWalletAddress: string;
  tokenAddress: string;
  claimedAmountWei: bigint;
  networkIndex: number;
}): Promise<VerificationResult> {
  const provider = providerForNetwork(params.networkIndex);
  let receipt: any;
  try {
    receipt = await provider.getTransactionReceipt(params.txHash);
  } catch (err: any) {
    return { ok: false, reason: `Could not fetch receipt: ${err?.message ?? String(err)}` };
  }

  const r = receipt?.value ?? receipt;
  if (r?.execution_status === "REVERTED") {
    return { ok: false, reason: "Transaction reverted." };
  }

  let tokenAddr: bigint;
  let expectedTo: bigint;
  try {
    tokenAddr = num.toBigInt(params.tokenAddress);
    expectedTo = num.toBigInt(params.operatingWalletAddress);
  } catch {
    return { ok: false, reason: "Misconfigured token or operating wallet address." };
  }

  const events: any[] = r?.events ?? [];
  for (const ev of events) {
    try {
      if (num.toBigInt(ev.from_address) !== tokenAddr) continue;
      if (!ev.keys?.length || num.toHex(ev.keys[0]) !== TRANSFER_SELECTOR) continue;

      // Recipient and amount sit in different places per shape (see above).
      const indexed = ev.keys.length >= 3;
      const data: string[] = ev.data ?? [];
      const to = indexed ? ev.keys[2] : data[1];
      const low = indexed ? data[0] : data[2];
      const high = indexed ? data[1] : data[3];
      if (to === undefined || low === undefined) continue;

      if (num.toBigInt(to) !== expectedTo) continue;

      const amount = num.toBigInt(low) + (high === undefined ? 0n : num.toBigInt(high) << 128n);

      if (amount >= params.claimedAmountWei) {
        return { ok: true, amountWei: amount };
      }
    } catch {
      continue;
    }
  }

  return { ok: false, reason: "No matching Transfer event found for the claimed amount and operating wallet." };
}

// Flow A: a private STRK20 transfer. Public receipt data can't show
// amount/recipient — private transfers hide both by protocol default.
// Verification instead means the operating wallet checking its own
// shielded note discovery for a note matching the claim. That capability
// lives behind this narrow interface, dependency-injected rather than
// imported directly, so this file (and its tests) don't need the real
// @starkware-libs/starknet-privacy-sdk installed — Phase 3 wires the real
// implementation; src/server/signer/noteDiscovery.ts is the placeholder
// until then.
export interface NoteDiscoveryClient {
  hasReceivedDeposit(params: { txHash: string; claimedAmountWei: bigint; tokenAddress: string }): Promise<boolean>;
}

export async function verifyFlowADeposit(params: {
  txHash: string;
  claimedAmountWei: bigint;
  tokenAddress: string;
  discovery: NoteDiscoveryClient;
}): Promise<VerificationResult> {
  const found = await params.discovery.hasReceivedDeposit({
    txHash: params.txHash,
    claimedAmountWei: params.claimedAmountWei,
    tokenAddress: params.tokenAddress,
  });
  if (!found) {
    return {
      ok: false,
      reason: "No matching shielded note found in the operating wallet's balance for this deposit.",
    };
  }
  return { ok: true, amountWei: params.claimedAmountWei };
}
