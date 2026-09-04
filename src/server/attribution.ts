// Settling a payment from what arrived on-chain, when the payer's browser
// never told us anything.
//
// Flow B resolves itself: a public transfer carries a hash, so /api/payments
// verifies it exactly as it would a client-reported one. Flow A does not. A
// shielded transfer publishes nothing, and — observed repeatedly on Sepolia —
// the wallet's strk20InvokeTransaction can broadcast and then never resolve
// its promise, so the page is left holding no hash at all. Public payments
// come back fine; private ones are the ones that go missing.
//
// What Nomos can still see is the note itself, through its viewing key. The
// note carries an amount, not a link — which is why every attempt reserves a
// unique amount (utils/paymentFingerprint.ts). That makes the amount an
// identifier, and this turns it back into a settled payment.
import { getStore } from "@/server/store";
import { getNoteDiscoveryClient } from "@/server/signer/noteDiscovery";
import { tokenAddressFor, type TokenSymbol } from "@/utils/constants";
import { netAfterFee, transactionFeeWei } from "@/utils/fees";
import { deliverPaymentWebhook } from "@/utils/webhook";

export type SettleResult =
  | { settled: true; reference: string; alreadySettled: boolean }
  | { settled: false; reason: "no-intent" | "already-closed" | "not-arrived" | "error"; detail?: string };

/**
 * Look for the note this intent is waiting on, and credit it if it is there.
 *
 * Safe to call repeatedly and from anywhere — the checkout polls it, and
 * reconciliation sweeps with it. claimShieldedNote is atomic, so a note backs
 * exactly one deposit no matter how many callers race.
 */
export async function settleIntentFromChain(intentId: string): Promise<SettleResult> {
  const store = getStore();

  const intent = await store.getPaymentIntent(intentId);
  if (!intent) return { settled: false, reason: "no-intent" };

  // Already settled — report the deposit rather than hunting a second arrival.
  if (intent.status !== "open") {
    const deposit = intent.depositId ? await store.getDepositById(intent.depositId) : null;
    return deposit
      ? { settled: true, reference: deposit.reference, alreadySettled: true }
      : { settled: false, reason: "already-closed" };
  }

  const tokenAddress = tokenAddressFor(intent.token as TokenSymbol, intent.networkIndex);
  if (tokenAddress === "0x0") return { settled: false, reason: "error", detail: "Unknown token." };

  try {
    const claimed = await store.listClaimedNoteIds(intent.networkIndex);
    const notes = await getNoteDiscoveryClient(intent.networkIndex).listNotes({ tokenAddress });

    // The reserved amount is what makes this a lookup rather than a guess.
    const match = notes.find((n) => n.amount === intent.amountWei && !claimed.has(n.id));
    if (!match) return { settled: false, reason: "not-arrived" };

    if (!(await store.claimShieldedNote(match.id, intent.networkIndex))) {
      return { settled: false, reason: "not-arrived" };
    }

    const feeWei = transactionFeeWei(intent.token, "A");
    const { deposit } = await store.recordDeposit({
      merchantAddress: intent.merchantAddress,
      networkIndex: intent.networkIndex,
      flow: "A",
      // Not a transaction hash and not pretending to be one: the note is what
      // identifies this payment, and it is unique per arrival.
      txHash: `note:${match.id}`,
      amountWei: intent.amountWei,
      feeWei,
      token: intent.token,
      linkId: intent.linkId,
      status: "verified",
    });
    await store.creditLedger({
      merchantAddress: intent.merchantAddress,
      networkIndex: intent.networkIndex,
      amountWei: netAfterFee(intent.amountWei, feeWei),
      token: intent.token,
      kind: "flow_a_deposit",
      depositId: deposit.id,
    });
    await store.matchPaymentIntent(intent.id, deposit.id);
    await deliverPaymentWebhook(deposit);

    return { settled: true, reference: deposit.reference, alreadySettled: false };
  } catch (err) {
    return { settled: false, reason: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}
