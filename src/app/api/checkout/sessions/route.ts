// Checkout Sessions — the programmatic sibling of a Payment Link.
//
// The two are genuinely different products and every comparable gateway
// separates them, so Nomos does too:
//
//   Payment Link      a person creates it in the dashboard and sends it to
//                     someone. Reusable by default, no expiry, no idea what
//                     order it belongs to.
//   Checkout Session  a merchant's *server* creates one per order at pay
//                     time, redirects the customer to the returned url, and
//                     gets them back at callbackUrl. Single-use, short-lived,
//                     and carries the merchant's own order id so the payment
//                     can be reconciled against their system.
//
// Underneath both are the same persisted link record — the difference is in
// the defaults and in what the caller gets back. A session returns a `url`,
// because a server that just created one has no way to build it otherwise.
import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { unauthorizedUnlessMerchant } from "@/server/merchantAuth";
import { getStore } from "@/server/store";
import { isTokenSymbol, isValidNetworkIndex, tokenDecimals, TokenSymbols } from "@/utils/constants";
import { formatFee, minimumPaymentWei } from "@/utils/fees";
import { parseTokenAmount } from "@/utils/payments";

// A checkout is abandoned or completed within minutes. Anything longer keeps
// a payable URL alive after the cart it belonged to is gone.
const DEFAULT_EXPIRY_SECONDS = 30 * 60;
const MAX_EXPIRY_SECONDS = 24 * 60 * 60;

function checkoutUrl(request: NextRequest, id: string): string {
  // Honour the proxy's view of the host — behind Vercel the request URL is
  // the internal one, and a customer cannot be redirected to that.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const origin =
    forwardedHost !== null
      ? `${forwardedProto ?? "https"}://${forwardedHost}`
      : request.nextUrl.origin;
  return `${origin}/pay?id=${id}`;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { merchantAddress, secretKey, amount, token, networkIndex, description, reference, callbackUrl, expiresIn } =
    body ?? {};

  if (typeof merchantAddress !== "string") {
    return NextResponse.json({ error: "merchantAddress is required." }, { status: 400 });
  }
  if (!isTokenSymbol(token)) {
    return NextResponse.json({ error: `token must be one of: ${TokenSymbols.join(", ")}.` }, { status: 400 });
  }
  if (!isValidNetworkIndex(networkIndex)) {
    return NextResponse.json({ error: "networkIndex is required and must be a supported network." }, { status: 400 });
  }

  let normalizedMerchant: string;
  try {
    normalizedMerchant = validateAndParseAddress(merchantAddress);
  } catch {
    return NextResponse.json({ error: "merchantAddress is not a valid Starknet address." }, { status: 400 });
  }

  // Unlike a Payment Link, a session is always for a specific order — an
  // open-amount checkout is a contradiction, so amount is required here.
  if (typeof amount !== "string" || amount.trim() === "") {
    return NextResponse.json(
      { error: 'amount is required, as a string in human units, e.g. "25".' },
      { status: 400 }
    );
  }
  const amountWei = parseTokenAmount(amount, tokenDecimals(token));
  if (amountWei === null) {
    return NextResponse.json({ error: "amount must be a positive decimal number." }, { status: 400 });
  }
  const minimum = minimumPaymentWei(token);
  if (amountWei < minimum) {
    return NextResponse.json(
      { error: `Minimum payment for ${token} is ${formatFee(token, minimum)}.` },
      { status: 400 }
    );
  }

  if (reference !== undefined && (typeof reference !== "string" || reference.length > 128)) {
    return NextResponse.json({ error: "reference must be a string of at most 128 characters." }, { status: 400 });
  }
  if (description !== undefined && typeof description !== "string") {
    return NextResponse.json({ error: "description must be a string." }, { status: 400 });
  }

  let callback: string | undefined;
  if (callbackUrl !== undefined) {
    if (typeof callbackUrl !== "string") {
      return NextResponse.json({ error: "callbackUrl must be a string." }, { status: 400 });
    }
    try {
      const parsed = new URL(callbackUrl);
      // The customer is redirected here after paying, so it has to be a real
      // web destination rather than javascript: or data:.
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
      callback = parsed.toString();
    } catch {
      return NextResponse.json({ error: "callbackUrl must be an http(s) URL." }, { status: 400 });
    }
  }

  if (expiresIn !== undefined && (typeof expiresIn !== "number" || expiresIn <= 0 || expiresIn > MAX_EXPIRY_SECONDS)) {
    return NextResponse.json(
      { error: `expiresIn must be a positive number of seconds, at most ${MAX_EXPIRY_SECONDS}.` },
      { status: 400 }
    );
  }

  const denied = await unauthorizedUnlessMerchant({
    request,
    address: normalizedMerchant,
    networkIndex,
    secretKey: typeof secretKey === "string" ? secretKey : null,
  });
  if (denied) return denied;

  const link = await getStore().createPaymentLink({
    merchantAddress: normalizedMerchant,
    networkIndex,
    amountWei,
    token,
    note: typeof description === "string" ? description : undefined,
    // The merchant's own order id, carried through to the deposit so a
    // payment can be matched back to their system without a lookup table.
    ref: typeof reference === "string" ? reference : undefined,
    expiresAt: Math.floor(Date.now() / 1000) + (typeof expiresIn === "number" ? expiresIn : DEFAULT_EXPIRY_SECONDS),
    // The defaults that make this a checkout rather than a link.
    singleUse: true,
    callbackUrl: callback,
  });

  return NextResponse.json(
    {
      id: link.id,
      url: checkoutUrl(request, link.id),
      status: "open",
      amount,
      amountWei: link.amountWei?.toString(),
      token: link.token,
      reference: link.ref,
      description: link.note,
      expiresAt: link.expiresAt,
      callbackUrl: link.callbackUrl,
      createdAt: link.createdAt,
    },
    { status: 201 }
  );
}
