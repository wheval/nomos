import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { SESSION_COOKIE, applySessionCookie, clearSessionCookie, decodeSession } from "@/server/merchantAuth";
import { challengeIsValid, issueChallenge, loginTypedData, walletOwnsAddress } from "@/server/walletProof";
import { isValidNetworkIndex } from "@/utils/constants";

// GET: the challenge half of the login — but only when one is actually
// needed.
//
// A session lasts two weeks, so most page loads already carry a valid one.
// Answering with a challenge regardless made the client sign again on every
// reload, which trains a merchant to approve wallet prompts without reading
// them. So this reports an existing session first, and issues a challenge
// only when there is nothing to reuse.
//
// When a challenge is returned it carries the exact typed data to sign it as,
// so the client never builds the message itself and the two sides cannot
// drift apart.
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

  // Already signed in as this wallet, on this network? Then nothing to prove.
  // Read through the same decoder that authorises real requests, so this can
  // never report a session that would not actually be honoured.
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (existing) {
    const session = decodeSession(existing);
    if (session && session.a === normalized.toLowerCase() && session.n === networkIndex) {
      return NextResponse.json({ authenticated: true });
    }
  }

  const challenge = issueChallenge(normalized, networkIndex);
  return NextResponse.json({
    authenticated: false,
    challenge,
    typedData: loginTypedData(challenge, networkIndex),
  });
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
