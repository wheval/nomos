import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { getStore } from "@/server/store";
import { isTokenSymbol, tokenDecimals, TokenSymbols } from "@/utils/constants";
import { parseTokenAmount } from "@/utils/payments";

// Creates a persisted Payment Link. Before this, a "link" was just URL
// query params the merchant's browser built client-side - nothing checked
// that the amount/recipient a customer eventually saw matched what the
// merchant actually intended, since there was no server-side record to
// compare against. Requires the merchant's own secret key, same auth model
// as every other write in this API - so a link can only ever be created
// "as" the merchant who controls that key.
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { merchantAddress, secretKey, amount, token, note, expiresIn } = body ?? {};
  if (typeof merchantAddress !== "string" || typeof secretKey !== "string") {
    return NextResponse.json({ error: "merchantAddress and secretKey are required." }, { status: 400 });
  }
  if (!isTokenSymbol(token)) {
    return NextResponse.json({ error: `token must be one of: ${TokenSymbols.join(", ")}.` }, { status: 400 });
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

  const store = getStore();
  const ok = await store.verifyMerchantSecret(normalizedMerchant, secretKey);
  if (!ok) {
    return NextResponse.json({ error: "Invalid secret key for this address." }, { status: 401 });
  }

  const link = await store.createPaymentLink({
    merchantAddress: normalizedMerchant,
    amountWei,
    token,
    note: typeof note === "string" && note.trim() ? note.trim() : undefined,
    expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
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
    },
    { status: 201 }
  );
}

// Lists a merchant's own Payment Links. Same bearer-secret auth as every
// other GET in this API.
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

  const store = getStore();
  const ok = await store.verifyMerchantSecret(normalizedTo, secretKey);
  if (!ok) {
    return NextResponse.json({ error: "Invalid secret key for this address." }, { status: 401 });
  }

  const links = await store.listPaymentLinksFor(normalizedTo);
  return NextResponse.json({
    links: links.map((l) => ({ ...l, amountWei: l.amountWei?.toString() })),
  });
}
