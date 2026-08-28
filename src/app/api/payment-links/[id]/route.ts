import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/server/store";

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

  return NextResponse.json({
    id: link.id,
    merchantAddress: link.merchantAddress,
    networkIndex: link.networkIndex,
    amountWei: link.amountWei?.toString(),
    token: link.token,
    note: link.note,
    ref: link.ref,
    expiresAt: link.expiresAt,
    revoked: link.revoked,
    expired,
    logoDataUrl: profile.logoDataUrl ?? link.logoDataUrl,
  });
}
