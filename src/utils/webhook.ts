// Best-effort webhook delivery, fired the moment a payment is recorded.
// This is the unblocked half of "notify the merchant a payment landed" -
// see the call-prep doc for why automated detection straight off the
// STRK20 pool (rather than off Nomos's own order log) is still an open
// architecture question pending the STRK20 team's answer on discovery
// services. This delivers off the write we already do in /api/payments,
// no viewing-key material involved.
import { getMerchantWebhookUrl, getWebhookSigningKey, hmacSha256Hex, type PaymentRecord } from "./store";

const DELIVERY_TIMEOUT_MS = 4000;

export async function deliverPaymentWebhook(record: PaymentRecord): Promise<void> {
  const url = await getMerchantWebhookUrl(record.to);
  if (!url) return;

  const signingKey = await getWebhookSigningKey(record.to);
  const payload = JSON.stringify({
    event: "payment.received",
    id: record.txHash,
    data: record,
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
