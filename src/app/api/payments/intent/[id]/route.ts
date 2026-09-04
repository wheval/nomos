// Has this payment arrived?
//
// The checkout polls this after invoking the wallet. It exists because the
// wallet's private-transfer call can broadcast and never resolve, leaving the
// page with no transaction hash to report — public payments come back fine,
// private ones are the ones that vanish. Rather than depending on the wallet,
// the page asks the server, which looks for the note itself.
//
// Unauthenticated like the checkout that calls it: it reveals only whether one
// intent the caller already holds the id for has been paid, and it cannot move
// money. Settling is idempotent.
import { NextRequest, NextResponse } from "next/server";
import { settleIntentFromChain } from "@/server/attribution";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await settleIntentFromChain(id);

  if (result.settled) {
    return NextResponse.json({ status: "paid", reference: result.reference });
  }
  if (result.reason === "no-intent") {
    return NextResponse.json({ error: "Unknown payment attempt." }, { status: 404 });
  }
  return NextResponse.json({ status: "pending" });
}
