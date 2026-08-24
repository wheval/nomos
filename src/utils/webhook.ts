// Best-effort webhook delivery, fired once a payment is confirmed and
// credited to a merchant's ledger. Flow A fires it right after recording
// (funds are already shielded); Flow B fires it from the shield-step
// worker once shielding confirms (Phase 5) — this function itself doesn't
// care which flow, only that the deposit is done.
import crypto from "crypto";
import { getStore, type Deposit } from "@/server/store";

const DELIVERY_TIMEOUT_MS = 4000;

function hmacSha256Hex(key: string, payload: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}

export async function deliverPaymentWebhook(deposit: Deposit): Promise<void> {
  const store = getStore();
  const url = await store.getMerchantWebhookUrl(deposit.merchantAddress);
  if (!url) return;

  const signingKey = await store.getWebhookSigningKey(deposit.merchantAddress);
  const payload = JSON.stringify({
    event: "payment.received",
    id: deposit.txHash,
    data: { ...deposit, amountWei: deposit.amountWei.toString() },
  });
  const signature = signingKey ? hmacSha256Hex(signingKey, payload) : "";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nomos-Signature": `sha256=${signature}`,
        "X-Nomos-Event": "payment.received",
      },
      body: payload,
      signal: controller.signal,
    });
  } catch (err) {
    // Best-effort: a merchant's webhook being down must never block or
    // fail the payment, which has already confirmed on-chain. A real
    // deployment would queue this for retry with backoff instead of
    // dropping it on one failed attempt.
    console.error(`[nomos webhook] delivery to ${url} failed:`, err);
  } finally {
    clearTimeout(timer);
  }
}
