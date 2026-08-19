import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { appendPayment, listPaymentsFor, verifyMerchantSecret, type PaymentRecord } from "@/utils/store";
import { deliverPaymentWebhook } from "@/utils/webhook";

// Records a completed payment against a Payment Link. Called by the /pay
// checkout page right after a transfer confirms on-chain - this is Nomos's
// own bookkeeping (order status), not a read of the STRK20 pool itself.
// Nobody needs a secret key to write here: the write is just "this link was
// paid," not access to anyone's balance.
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { to, amount, token, note, ref, txHash } = body ?? {};
  if (typeof to !== "string" || typeof amount !== "string" || typeof txHash !== "string") {
    return NextResponse.json({ error: "to, amount, and txHash are required strings." }, { status: 400 });
  }
  let normalizedTo: string;
  try {
    normalizedTo = validateAndParseAddress(to);
  } catch {
    return NextResponse.json({ error: "to is not a valid Starknet address." }, { status: 400 });
  }

  const record: PaymentRecord = {
    to: normalizedTo,
    amount,
    token: typeof token === "string" ? token : "STRK",
    note: typeof note === "string" ? note : undefined,
    ref: typeof ref === "string" ? ref : undefined,
    txHash,
    recordedAt: Math.floor(Date.now() / 1000),
  };
  await appendPayment(record);
  await deliverPaymentWebhook(record);

  return NextResponse.json({ ok: true }, { status: 201 });
}

// Lists recorded payments for a merchant address - the actual "business
// API" surface. Requires the merchant's own secret key as a bearer token,
// same auth model as Stripe/Paystack: the public key is safe to embed in a
// widget, the secret key never leaves the merchant's own backend/dashboard.
export async function GET(request: NextRequest) {
  const to = request.nextUrl.searchParams.get("to");
  const auth = request.headers.get("authorization") ?? "";
  const secretKey = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!to) {
    return NextResponse.json({ error: "Missing ?to=<address>." }, { status: 400 });
  }
  let normalizedTo: string;
  try {
    normalizedTo = validateAndParseAddress(to);
  } catch {
    return NextResponse.json({ error: "to is not a valid Starknet address." }, { status: 400 });
  }
  if (!secretKey) {
    return NextResponse.json({ error: "Missing Authorization: Bearer <secret key>." }, { status: 401 });
  }
  const ok = await verifyMerchantSecret(normalizedTo, secretKey);
  if (!ok) {
    return NextResponse.json({ error: "Invalid secret key for this address." }, { status: 401 });
  }

  const payments = await listPaymentsFor(normalizedTo);
  return NextResponse.json({ payments });
}
