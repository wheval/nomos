// Records what a payer is about to do, before their wallet is invoked.
//
// A private STRK20 transfer publishes nothing on-chain, so Nomos cannot watch
// for "did anyone pay this link?" — there is no event. At the moment of
// payment the only party holding the transaction hash is the payer's browser,
// which made the browser load-bearing settlement infrastructure. Three real
// payments were lost to a hung wallet promise, a failed receipt poll, and a
// closed tab.
//
// This is the fix. Afterwards Nomos can see an unclaimed note arrive — its
// viewing key finds it — but not who it was for, because a note carries an
// amount and not a link. The intent supplies that missing half, so
// reconciliation can attribute an orphaned payment with no browser and no
// human involved.
//
// Deliberately unauthenticated, like the checkout page that calls it: anyone
// holding a payment link may pay it. An intent grants nothing — it cannot move
// money and cannot credit anyone. The worst a flood of them does is create
// rows that never match, which is why attribution requires a real on-chain
// arrival as well.
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { isTokenSymbol, isValidNetworkIndex } from "@/utils/constants";
import { uniquePayableAmount } from "@/utils/paymentFingerprint";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { linkId, flow, amountWei } = body ?? {};
  if (flow !== "A" && flow !== "B") {
    return NextResponse.json({ error: "flow must be 'A' or 'B'." }, { status: 400 });
  }
  if (typeof linkId !== "string" || linkId.length === 0) {
    return NextResponse.json({ error: "linkId is required." }, { status: 400 });
  }
  let amount: bigint;
  try {
    amount = BigInt(String(amountWei));
    if (amount <= 0n) throw new Error();
  } catch {
    return NextResponse.json({ error: "amountWei must be a positive integer string." }, { status: 400 });
  }

  const store = getStore();
  // Merchant, token and network come from the stored link, never from the
  // caller — the same rule /api/payments follows, and for the same reason: an
  // intent that named its own merchant would be a way to misattribute a
  // stranger's payment.
  const link = await store.getPaymentLink(linkId);
  if (!link) {
    return NextResponse.json({ error: "Payment link not found." }, { status: 404 });
  }
  if (link.revoked) {
    return NextResponse.json({ error: "This payment link has been revoked." }, { status: 410 });
  }
  if (link.expiresAt !== undefined && Date.now() / 1000 > link.expiresAt) {
    return NextResponse.json({ error: "This payment link has expired." }, { status: 410 });
  }
  if (!isTokenSymbol(link.token) || !isValidNetworkIndex(link.networkIndex)) {
    return NextResponse.json({ error: "Payment link is misconfigured." }, { status: 500 });
  }

  // Quote an amount no other open attempt is using, so the note that
  // eventually lands names exactly one intent. This is what turns attribution
  // from a guess into a lookup — see utils/paymentFingerprint.ts.
  const open = await store.listOpenPaymentIntents(link.networkIndex);
  const payable = uniquePayableAmount(
    amount,
    link.token,
    open.filter((i) => i.token === link.token).map((i) => i.amountWei)
  );

  const intent = await store.createPaymentIntent({
    linkId: link.id,
    merchantAddress: link.merchantAddress,
    networkIndex: link.networkIndex,
    flow,
    amountWei: payable,
    token: link.token,
  });

  // The caller must pay exactly this, not the link's round figure.
  return NextResponse.json(
    { intentId: intent.id, amountWei: payable.toString(), token: link.token },
    { status: 201 }
  );
}
