import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { applySessionCookie, clearSessionCookie } from "@/server/merchantAuth";
import { challengeIsValid, issueChallenge, loginTypedData, walletOwnsAddress } from "@/server/walletProof";
import { isValidNetworkIndex } from "@/utils/constants";

// GET: the challenge half of the login. Returns something for the wallet to
// sign, plus the exact typed data to sign it as, so the client never builds
// the message itself and the two sides cannot drift apart.
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const networkRaw = request.nextUrl.searchParams.get("network");
  const networkIndex = networkRaw !== null ? Number(networkRaw) : NaN;

  if (typeof address !== "string" || address.length === 0) {
    return NextResponse.json({ error: "address is required." }, { status: 400 });
  }
  if (!isValidNetworkIndex(networkIndex)) {
    return NextResponse.json({ error: "network is required and must be a supported network." }, { status: 400 });
  }
  let normalized: string;
  try {
    normalized = validateAndParseAddress(address);
  } catch {
    return NextResponse.json({ error: "address is not a valid Starknet address." }, { status: 400 });
  }

  const challenge = issueChallenge(normalized, networkIndex);
  return NextResponse.json({ challenge, typedData: loginTypedData(challenge, networkIndex) });
}

// POST: the connected wallet is the dashboard login — but connecting is not
// the proof, signing is. A Starknet address is public, so accepting one on
// its own handed anybody who knew a merchant's address that merchant's
// console, ledger and payout endpoint. The wallet must sign the challenge
// from GET, and that signature is checked against the account contract
// before any session exists.
//
// Sets a same-origin session cookie scoped to that address + network so
// console pages can create links / read the ledger / pay out without an API
// key.
export async function POST(request: NextRequest) {
  let body: { address?: unknown; networkIndex?: unknown; challenge?: unknown; signature?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { address, networkIndex, challenge, signature } = body ?? {};
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
  if (typeof challenge !== "string" || !Array.isArray(signature) || signature.length === 0) {
    return NextResponse.json(
      { error: "challenge and signature are required. Fetch a challenge from GET first." },
      { status: 400 }
    );
  }
  if (!challengeIsValid(challenge, normalized, networkIndex)) {
    return NextResponse.json(
      { error: "That challenge is not one we issued for this address, or it has expired." },
      { status: 401 }
    );
  }
  const owns = await walletOwnsAddress({
    address: normalized,
    networkIndex,
    challenge,
    signature: signature.map(String),
  });
  if (!owns) {
    return NextResponse.json({ error: "Signature does not prove ownership of that address." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  applySessionCookie(res, normalized, networkIndex);
  return res;
}

// DELETE: wallet disconnected — drop the dashboard session.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
