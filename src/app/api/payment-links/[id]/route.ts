import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { unauthorizedUnlessMerchant } from "@/server/merchantAuth";

// Public, unauthenticated read - this is what the checkout page fetches
// instead of trusting raw URL query params. Only exposes fields a customer
// is meant to see anyway (a Payment Link is inherently shareable); nothing
// here is a merchant secret.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const link = await store.getPaymentLink(id);
  if (!link) {
    return NextResponse.json({ error: "Payment link not found." }, { status: 404 });
  }

  const expired = link.expiresAt !== undefined && Date.now() / 1000 > link.expiresAt;
  const profile = await store.getMerchantProfile(link.merchantAddress, link.networkIndex);

  // An invoice is payable once, so checkout needs to know it's settled before
  // the customer spends gas on a payment that would be rejected. A failed
  // attempt doesn't close it. Reusable pages skip the lookup entirely.
  let paid = false;
  if (link.singleUse) {
    const deposits = await store.listDepositsForLink(link.id);
    paid = deposits.some((d) => d.status !== "rejected" && d.status !== "shield_failed");
  }

  return NextResponse.json({
    id: link.id,
    // merchantAddress is deliberately NOT returned. This endpoint is public,
    // so anyone holding a payment link would learn the merchant's wallet —
    // their identity and login address — on a product whose entire promise is
    // that payments stay private. Nothing needs it either: payments settle to
    // the operating wallet, and /api/payments resolves the merchant from the
    // stored link rather than from anything the client sends.
    merchantName: profile.displayName ?? null,
    networkIndex: link.networkIndex,
    amountWei: link.amountWei?.toString(),
    token: link.token,
    note: link.note,
    ref: link.ref,
    expiresAt: link.expiresAt,
    revoked: link.revoked,
    expired,
    singleUse: link.singleUse,
    paid,
    callbackUrl: link.callbackUrl,
    logoDataUrl: profile.logoDataUrl ?? link.logoDataUrl,
  });
}

// Revoke a link so it stops accepting payments. The store has always
// supported this but nothing exposed it, leaving a merchant no way to kill a
// link they'd already shared. Authorisation is resolved from the *stored*
// link's own merchant and network, never from the caller's claim, so knowing
// an id is not enough to revoke someone else's link.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();

  const link = await store.getPaymentLink(id);
  if (!link) {
    return NextResponse.json({ error: "Payment link not found." }, { status: 404 });
  }

  const denied = await unauthorizedUnlessMerchant({
    request,
    address: link.merchantAddress,
    networkIndex: link.networkIndex,
  });
  if (denied) return denied;

  const revoked = await store.revokePaymentLink(id, link.merchantAddress);
  if (!revoked) {
    return NextResponse.json({ error: "Could not revoke this payment link." }, { status: 409 });
  }
  return NextResponse.json({ id, revoked: true });
}
