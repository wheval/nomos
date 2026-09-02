// Status of one Checkout Session. A merchant's server polls this after the
// customer returns, or uses it to reconcile if they never came back.
//
// Authenticated, unlike the public link endpoint the checkout page itself
// reads: this reports the payment's own reference and transaction, which is
// the merchant's business and nobody else's.
import { NextRequest, NextResponse } from "next/server";
import { unauthorizedUnlessMerchant } from "@/server/merchantAuth";
import { getStore } from "@/server/store";
import type { Deposit } from "@/server/store/types";

// Mirrors what the merchant actually needs to decide: ship the order, keep
// waiting, or treat it as dead.
type SessionStatus = "open" | "paid" | "processing" | "expired" | "revoked" | "failed";

function statusFor(
  link: { revoked: boolean; expiresAt?: number },
  deposits: Deposit[]
): SessionStatus {
  // A settled payment outranks expiry — a session paid two seconds before it
  // lapsed is paid, and must never read as expired to the merchant.
  const settled = deposits.find((d) => d.status === "verified" || d.status === "shielded");
  if (settled) return "paid";
  // Flow B lands publicly and is credited once shielded; it is real money in
  // hand, just not finished, so it is neither "open" nor "paid".
  if (deposits.some((d) => d.status === "pending_shield" || d.status === "pending_verify")) return "processing";
  if (link.revoked) return "revoked";
  if (link.expiresAt !== undefined && Date.now() / 1000 > link.expiresAt) return "expired";
  if (deposits.length > 0 && deposits.every((d) => d.status === "rejected" || d.status === "shield_failed")) {
    return "failed";
  }
  return "open";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();

  const link = await store.getPaymentLink(id);
  if (!link) {
    return NextResponse.json({ error: "Checkout session not found." }, { status: 404 });
  }

  // Authorisation resolves from the stored session's own merchant, never from
  // a caller's claim — knowing an id must not be enough to read someone
  // else's order.
  const denied = await unauthorizedUnlessMerchant({
    request,
    address: link.merchantAddress,
    networkIndex: link.networkIndex,
    secretKey: request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null,
  });
  if (denied) return denied;

  const deposits = await store.listDepositsForLink(link.id);
  const paid = deposits.find((d) => d.status === "verified" || d.status === "shielded");

  return NextResponse.json({
    id: link.id,
    status: statusFor(link, deposits),
    amountWei: link.amountWei?.toString(),
    token: link.token,
    reference: link.ref,
    description: link.note,
    expiresAt: link.expiresAt,
    createdAt: link.createdAt,
    // Present once someone has paid: the per-payment reference to quote in
    // support, the transaction to verify, and what was actually credited
    // after the Nomos fee.
    payment: paid
      ? {
          reference: paid.reference,
          txHash: paid.txHash,
          flow: paid.flow,
          amountWei: paid.amountWei.toString(),
          feeWei: (paid.feeWei ?? 0n).toString(),
          netWei: (paid.amountWei - (paid.feeWei ?? 0n)).toString(),
          paidAt: paid.recordedAt,
        }
      : null,
  });
}
