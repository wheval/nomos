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
// imported directly, so this file and its tests don't pull in the real
// @starkware-libs/starknet-privacy-sdk. The production implementation is
// src/server/signer/noteDiscovery.ts, which calls the SDK's discoverNotes
// against the live pool.
export type CandidateNote = {
  /** Stable per-note identifier from the SDK; the unit we claim. */
  id: string;
  amount: bigint;
  /** Block the note was created in, when discovery reports it. */
  createdBlock?: number;
};

export interface NoteDiscoveryClient {
  /** Unspent notes of this token held by the operating wallet. */
  listNotes(params: { tokenAddress: string }): Promise<CandidateNote[]>;
}

/**
 * Flow A: a private STRK20 transfer. The chain reveals neither sender,
 * recipient nor amount, so there is no Transfer event to decode — settlement
 * rests on the operating wallet finding a matching incoming note.
 *
 * Matching on amount alone is not enough, and used to be the whole check.
 * The operating wallet is shared custody for every merchant, so any note in
 * it satisfied an amount match: a caller could post a fabricated txHash with
 * a plausible round amount, be credited for a payment someone else made, and
 * withdraw it. Three independent conditions now have to hold:
 *
 *   1. The transaction exists on-chain and succeeded. A fabricated hash dies
 *      here, before any note is considered.
 *   2. A note matches the claimed token and amount, and — where discovery
 *      reports a creation block — was created in the same block as that
 *      transaction. This ties the note to *this* payment rather than any
 *      payment of the same size.
 *   3. The note has not already settled a deposit. `claimNote` is atomic, so
 *      the same note can never be credited twice even under a race.
 *
 * Failing closed matters more than accepting a good payment here: a rejected
 * real payment is visible and recoverable, a wrongly credited one is money
 * out of shared custody.
 */
export async function verifyFlowADeposit(params: {
  txHash: string;
  claimedAmountWei: bigint;
  tokenAddress: string;
  networkIndex: number;
  discovery: NoteDiscoveryClient;
  /** Resolves false when the note is already spent. Must be atomic. */
  claimNote: (noteId: string) => Promise<boolean>;
}): Promise<VerificationResult> {
  const provider = providerForNetwork(params.networkIndex);

  // 1. The transaction has to be real and successful.
  let receipt: any;
  try {
    receipt = await provider.getTransactionReceipt(params.txHash);
  } catch {
    return { ok: false, reason: "No such transaction on this network." };
  }
  const r = receipt?.value ?? receipt;
  if (!r) return { ok: false, reason: "No such transaction on this network." };
  if (r.execution_status === "REVERTED") return { ok: false, reason: "Transaction reverted." };

  const txBlock: number | undefined =
    typeof r.block_number === "number" ? r.block_number : undefined;

  // 2. Candidate notes: right token, right amount, and same block as the tx.
  const notes = await params.discovery.listNotes({ tokenAddress: params.tokenAddress });
  const sameAmount = notes.filter((n) => n.amount === params.claimedAmountWei);
  if (sameAmount.length === 0) {
    return {
      ok: false,
      reason: "No matching shielded note found in the operating wallet's balance for this deposit.",
    };
  }

  // Narrow by block only when discovery actually reports creation blocks. If
  // it reports none, fall back to the amount match rather than rejecting a
  // genuine payment — the claim below still bounds the damage to one credit
  // per note, which is what stops shared custody being drained.
  const blocksKnown = sameAmount.some((n) => n.createdBlock !== undefined);
  const candidates =
    txBlock !== undefined && blocksKnown
      ? sameAmount.filter((n) => n.createdBlock === txBlock)
      : sameAmount;

  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "No shielded note from this transaction's block matches the claimed amount.",
    };
  }

  // 3. Claim one. First success wins; a loser here means someone else's
  // deposit already settled against that note.
  for (const note of candidates) {
    if (await params.claimNote(note.id)) {
      return { ok: true, amountWei: params.claimedAmountWei };
    }
  }

  return {
    ok: false,
    reason: "The matching shielded note has already been credited to another deposit.",
  };
}
