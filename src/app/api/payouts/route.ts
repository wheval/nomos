import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { getStore } from "@/server/store";
import { getPayoutExecutor } from "@/server/signer/payoutExecutor";

// POST: merchant-initiated withdrawal against their ledger balance.
// Checks the balance but does NOT debit until execution actually succeeds
// - a payout that fails to broadcast (e.g. the payout executor isn't
// configured yet) must never silently lose track of the merchant's funds.
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { merchantAddress, secretKey, destination, amountWei, mode } = body ?? {};
  if (
    typeof merchantAddress !== "string" ||
    typeof secretKey !== "string" ||
    typeof destination !== "string" ||
    typeof amountWei !== "string" ||
    (mode !== "withdraw" && mode !== "transfer")
  ) {
    return NextResponse.json(
      { error: "merchantAddress, secretKey, destination, amountWei, and mode ('withdraw'|'transfer') are required." },
      { status: 400 }
    );
  }

  let normalizedMerchant: string;
  let normalizedDestination: string;
  try {
    normalizedMerchant = validateAndParseAddress(merchantAddress);
    normalizedDestination = validateAndParseAddress(destination);
  } catch {
    return NextResponse.json({ error: "merchantAddress or destination is not a valid Starknet address." }, { status: 400 });
  }

  let requestedWei: bigint;
  try {
    requestedWei = BigInt(amountWei);
    if (requestedWei <= 0n) throw new Error();
  } catch {
    return NextResponse.json({ error: "amountWei must be a positive integer string (wei)." }, { status: 400 });
  }

  const store = getStore();
  const ok = await store.verifyMerchantSecret(normalizedMerchant, secretKey);
  if (!ok) {
    return NextResponse.json({ error: "Invalid secret key for this address." }, { status: 401 });
  }

  const balance = await store.getLedgerBalance(normalizedMerchant);
  if (balance < requestedWei) {
    return NextResponse.json(
      { error: `Insufficient balance: requested ${requestedWei}, available ${balance}.` },
      { status: 422 }
    );
  }

  const payout = await store.createPayout({
    merchantAddress: normalizedMerchant,
    destination: normalizedDestination,
    amountWei: requestedWei,
    mode,
  });

  try {
    await store.updatePayoutStatus(payout.id, "broadcasting");
    const executor = getPayoutExecutor();
    const { txHash } =
      mode === "withdraw"
        ? await executor.executeWithdraw({ amountWei: requestedWei, destination: normalizedDestination })
        : await executor.executeTransfer({ amountWei: requestedWei, destination: normalizedDestination });

    await store.debitLedger({
      merchantAddress: normalizedMerchant,
      amountWei: requestedWei,
      kind: "payout",
      payoutId: payout.id,
    });
    await store.updatePayoutStatus(payout.id, "confirmed", txHash);
    return NextResponse.json({ ok: true, payoutId: payout.id, status: "confirmed", txHash }, { status: 201 });
  } catch (err: any) {
    await store.updatePayoutStatus(payout.id, "failed");
    return NextResponse.json(
      { ok: false, payoutId: payout.id, status: "failed", error: err?.message ?? String(err) },
      { status: 502 }
    );
  }
}

// GET: payout history for a merchant. Same bearer-secret auth as /api/payments.
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

  const payouts = await store.listPayoutsFor(normalizedTo);
  return NextResponse.json({
    payouts: payouts.map((p) => ({ ...p, amountWei: p.amountWei.toString() })),
  });
}
