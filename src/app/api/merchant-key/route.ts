import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { getMerchantPublicKey, issueMerchantKey } from "@/utils/store";

// GET: the merchant's current public key, if a key pair has already been
// issued for this address. Safe to call from the browser - it's a public
// key.
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "Missing ?address=." }, { status: 400 });
  }
  let normalized: string;
  try {
    normalized = validateAndParseAddress(address);
  } catch {
    return NextResponse.json({ error: "address is not a valid Starknet address." }, { status: 400 });
  }
  const publicKey = await getMerchantPublicKey(normalized);
  return NextResponse.json({ publicKey });
}

// POST: issue (or rotate) a key pair for the connected wallet address. The
// secret key is returned once, in this response only - only its hash is
// ever persisted, so there is no "forgot my secret key" recovery, same as
// any real payments API.
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { address } = body ?? {};
  if (typeof address !== "string") {
    return NextResponse.json({ error: "address is required." }, { status: 400 });
  }
  let normalized: string;
  try {
    normalized = validateAndParseAddress(address);
  } catch {
    return NextResponse.json({ error: "address is not a valid Starknet address." }, { status: 400 });
  }
  const { publicKey, secretKey } = await issueMerchantKey(normalized);
  return NextResponse.json({ publicKey, secretKey });
}
