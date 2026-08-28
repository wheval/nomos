import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { applySessionCookie, clearSessionCookie } from "@/server/merchantAuth";
import { isValidNetworkIndex } from "@/utils/constants";

// POST: the connected wallet is the dashboard login. Sets a same-origin
// session cookie scoped to that address + network so console pages can
// create links / read the ledger / pay out without an API key.
export async function POST(request: NextRequest) {
  let body: { address?: unknown; networkIndex?: unknown };
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
