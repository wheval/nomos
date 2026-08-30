import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { unauthorizedUnlessMerchant } from "@/server/merchantAuth";
import { getStore } from "@/server/store";
import { isTokenSymbol, isValidNetworkIndex, tokenDecimals, TokenSymbols } from "@/utils/constants";
import { parseTokenAmount } from "@/utils/payments";

// Creates a persisted Payment Link. Before this, a "link" was just URL
// query params the merchant's browser built client-side - nothing checked
// that the amount/recipient a customer eventually saw matched what the
// merchant actually intended, since there was no server-side record to
// compare against. Auth is the dashboard wallet session *or* a secret
// API key (programmatic). Wallet connect is enough to create a link.
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { merchantAddress, secretKey, amount, token, note, expiresIn, networkIndex, logoDataUrl, singleUse, callbackUrl } = body ?? {};
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

  let amountWei: bigint | undefined;
  if (amount !== undefined && amount !== null && amount !== "") {
    if (typeof amount !== "string") {
      return NextResponse.json({ error: "amount must be a string in human units, e.g. \"25\"." }, { status: 400 });
    }
    const parsed = parseTokenAmount(amount, tokenDecimals(token));
    if (parsed === null) {
      return NextResponse.json({ error: "amount must be a positive decimal number." }, { status: 400 });
    }
    amountWei = parsed;
  }

  if (expiresIn !== undefined && (typeof expiresIn !== "number" || expiresIn <= 0)) {
    return NextResponse.json({ error: "expiresIn must be a positive number of seconds." }, { status: 400 });
  }

  if (singleUse !== undefined && typeof singleUse !== "boolean") {
    return NextResponse.json({ error: "singleUse must be true or false." }, { status: 400 });
  }

  // The payer's browser is sent here after checkout, so it has to be a real
  // absolute http(s) URL — anything else (javascript:, data:, a bare path)
  // would either break the redirect or hand an attacker a way to smuggle a
  // scheme into the customer's browser.
  let callback: string | undefined;
  if (callbackUrl !== undefined && callbackUrl !== null && callbackUrl !== "") {
    if (typeof callbackUrl !== "string") {
      return NextResponse.json({ error: "callbackUrl must be a string." }, { status: 400 });
    }
    let parsedCallback: URL;
    try {
      parsedCallback = new URL(callbackUrl);
    } catch {
      return NextResponse.json({ error: "callbackUrl must be an absolute URL." }, { status: 400 });
    }
    if (parsedCallback.protocol !== "https:" && parsedCallback.protocol !== "http:") {
      return NextResponse.json({ error: "callbackUrl must use http or https." }, { status: 400 });
    }
    callback = parsedCallback.toString();
  }

  const denied = await unauthorizedUnlessMerchant({
    request,
    address: normalizedMerchant,
    networkIndex,
    secretKey: typeof secretKey === "string" ? secretKey : null,
  });
  if (denied) return denied;

  let logo: string | undefined;
  if (logoDataUrl !== undefined && logoDataUrl !== null && logoDataUrl !== "") {
    if (typeof logoDataUrl !== "string" || !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(logoDataUrl)) {
      return NextResponse.json({ error: "logoDataUrl must be a PNG, JPEG, WebP, or GIF data URL." }, { status: 400 });
    }
    if (logoDataUrl.length > 180_000) {
      return NextResponse.json({ error: "Logo is too large — keep it under ~120KB." }, { status: 400 });
    }
    logo = logoDataUrl;
  }

  const store = getStore();
  const link = await store.createPaymentLink({
    merchantAddress: normalizedMerchant,
    networkIndex,
    amountWei,
    token,
    note: typeof note === "string" && note.trim() ? note.trim() : undefined,
    expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
    logoDataUrl: logo,
    singleUse: singleUse === true,
    callbackUrl: callback,
  });

  return NextResponse.json(
    {
      id: link.id,
      ref: link.ref,
      amountWei: link.amountWei?.toString(),
      token: link.token,
      note: link.note,
      expiresAt: link.expiresAt,
      createdAt: link.createdAt,
      singleUse: link.singleUse,
      callbackUrl: link.callbackUrl,
    },
    { status: 201 }
  );
}

// Lists a merchant's own Payment Links. Dashboard session or bearer secret.
export async function GET(request: NextRequest) {
  const to = request.nextUrl.searchParams.get("to");
  const networkRaw = request.nextUrl.searchParams.get("network");

  if (!to) {
    return NextResponse.json({ error: "Missing ?to=<address>." }, { status: 400 });
  }
  const networkIndex = networkRaw !== null ? Number(networkRaw) : NaN;
  if (!isValidNetworkIndex(networkIndex)) {
    return NextResponse.json({ error: "Missing or invalid ?network=." }, { status: 400 });
  }
  let normalizedTo: string;
  try {
    normalizedTo = validateAndParseAddress(to);
  } catch {
    return NextResponse.json({ error: "to is not a valid Starknet address." }, { status: 400 });
  }
  const denied = await unauthorizedUnlessMerchant({ request, address: normalizedTo, networkIndex });
  if (denied) return denied;

  const store = getStore();

  const links = await store.listPaymentLinksFor(normalizedTo, networkIndex);
  return NextResponse.json({
    links: links.map((l) => ({ ...l, amountWei: l.amountWei?.toString() })),
  });
}
