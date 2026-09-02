// Best-effort webhook delivery, fired once a payment is confirmed and
// credited to a merchant's ledger. Flow A fires it right after recording
// (funds are already shielded); Flow B fires it from the shield-step
// worker once shielding confirms (Phase 5) — this function itself doesn't
// care which flow, only that the deposit is done.
import crypto from "crypto";
import { getStore, type Deposit } from "@/server/store";

const DELIVERY_TIMEOUT_MS = 4000;
// Backoff schedule after the first attempt: ~5s, 30s, 2m, 5m.
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 300_000];

function hmacSha256Hex(key: string, payload: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}

export async function deliverPaymentWebhook(deposit: Deposit): Promise<void> {
  const store = getStore();
  const url = await store.getMerchantWebhookUrl(deposit.merchantAddress, deposit.networkIndex);
  if (!url) return;

  const signingKey = await store.getWebhookSigningKey(deposit.merchantAddress, deposit.networkIndex);
  const payload = JSON.stringify({
    event: "payment.received",
    id: deposit.txHash,
    data: { ...deposit, amountWei: deposit.amountWei.toString(), feeWei: (deposit.feeWei ?? 0n).toString() },
  });
  const signature = signingKey ? hmacSha256Hex(signingKey, payload) : "";

  await deliverWithRetry(url, payload, signature, deposit.reference);
}

async function attempt(url: string, payload: string, signature: string, reference: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nomos-Signature": `sha256=${signature}`,
        "X-Nomos-Event": "payment.received",
        // Lets a receiver recognise a retry of a delivery it already
        // processed, instead of double-crediting an order.
        "X-Nomos-Reference": reference,
      },
      body: payload,
      signal: controller.signal,
    });
    // Anything outside 2xx is worth retrying: a 500 is transient, and a 404
    // usually means the endpoint isn't deployed yet rather than never will be.
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Retry with backoff rather than dropping the event on one failed attempt.
//
// A merchant's endpoint being briefly down used to mean the notification was
// gone for good, and with no verify endpoint there was nothing to reconcile
// against — the payment simply went unnoticed. Delivery still never blocks or
// fails the payment itself, which has already confirmed on-chain.
//
// This runs in-process, so it survives only as long as the server does; a
// durable queue is the right home for it once one exists. Even so, covering
// the first few minutes removes the common case (a deploy, a restart, a blip).
async function deliverWithRetry(url: string, payload: string, signature: string, reference: string): Promise<void> {
  if (await attempt(url, payload, signature, reference)) return;

  void (async () => {
    for (const delayMs of RETRY_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (await attempt(url, payload, signature, reference)) return;
    }
    console.error(
      `[nomos webhook] delivery to ${url} failed after ${RETRY_DELAYS_MS.length + 1} attempts ` +
        `(reference ${reference}); the merchant can still reconcile via GET /api/transactions/${reference}`,
    );
  })();
}
