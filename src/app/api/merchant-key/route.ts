import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { getStore } from "@/server/store";
import { isValidNetworkIndex } from "@/utils/constants";

// GET: the merchant's current public key for the given network, if a key
// pair has already been issued. Safe to call from the browser - it's a
// public key. Test and live are entirely separate key pairs (see
// docs/ARCHITECTURE.md) - ?network= picks which one.
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const networkRaw = request.nextUrl.searchParams.get("network");
  if (!address) {
    return NextResponse.json({ error: "Missing ?address=." }, { status: 400 });
  }
  const networkIndex = networkRaw !== null ? Number(networkRaw) : NaN;
  if (!isValidNetworkIndex(networkIndex)) {
    return NextResponse.json({ error: "Missing or invalid ?network=." }, { status: 400 });
  }
  let normalized: string;
  try {
    normalized = validateAndParseAddress(address);
  } catch {
    return NextResponse.json({ error: "address is not a valid Starknet address." }, { status: 400 });
  }
  const publicKey = await getStore().getMerchantPublicKey(normalized, networkIndex);
  return NextResponse.json({ publicKey });
}

// POST: issue (or rotate) a key pair for the connected wallet address, on
// the given network. The secret key is returned once, in this response
// only - only its hash is ever persisted, so there is no "forgot my secret
// key" recovery, same as any real payments API. Rotating the test-mode key
// never touches the live-mode key, and vice versa.
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { address, networkIndex } = body ?? {};
  if (typeof address !== "string") {
    return NextResponse.json({ error: "address is required." }, { status: 400 });
  }
  if (!isValidNetworkIndex(networkIndex)) {
    return NextResponse.json({ error: "networkIndex is required and must be a supported network." }, { status: 400 });
  }
  let normalized: string;
  try {
    normalized = validateAndParseAddress(address);
  } catch {
    return NextResponse.json({ error: "address is not a valid Starknet address." }, { status: 400 });
  }
  const { publicKey, secretKey } = await getStore().issueMerchantKey(normalized, networkIndex);
  return NextResponse.json({ publicKey, secretKey });
}
