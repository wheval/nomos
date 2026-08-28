import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { unauthorizedUnlessMerchant } from "@/server/merchantAuth";
import { getStore } from "@/server/store";
import { getPayoutExecutor } from "@/server/signer/payoutExecutor";
import { isTokenSymbol, isValidNetworkIndex, TokenSymbols } from "@/utils/constants";

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

  const { merchantAddress, secretKey, destination, amountWei, token, mode, networkIndex } = body ?? {};
  if (
    typeof merchantAddress !== "string" ||
    typeof destination !== "string" ||
    typeof amountWei !== "string" ||
    (mode !== "withdraw" && mode !== "transfer")
  ) {
    return NextResponse.json(
      { error: "merchantAddress, destination, amountWei, and mode ('withdraw'|'transfer') are required." },
      { status: 400 }
    );
  }
  if (!isTokenSymbol(token)) {
    return NextResponse.json({ error: `token must be one of: ${TokenSymbols.join(", ")}.` }, { status: 400 });
  }
  if (!isValidNetworkIndex(networkIndex)) {
    return NextResponse.json({ error: "networkIndex is required and must be a supported network." }, { status: 400 });
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

  const denied = await unauthorizedUnlessMerchant({
    request,
    address: normalizedMerchant,
    networkIndex,
    secretKey: typeof secretKey === "string" ? secretKey : null,
  });
  if (denied) return denied;

  const store = getStore();

  const balance = await store.getLedgerBalance(normalizedMerchant, token, networkIndex);
  if (balance < requestedWei) {
    return NextResponse.json(
      { error: `Insufficient balance: requested ${requestedWei}, available ${balance}.` },
      { status: 422 }
    );
  }

  const payout = await store.createPayout({
    merchantAddress: normalizedMerchant,
    networkIndex,
    destination: normalizedDestination,
    amountWei: requestedWei,
    token,
    mode,
  });

  try {
    await store.updatePayoutStatus(payout.id, "broadcasting");
    const executor = getPayoutExecutor(networkIndex);
    const { txHash } =
      mode === "withdraw"
        ? await executor.executeWithdraw({ amountWei: requestedWei, token, destination: normalizedDestination })
        : await executor.executeTransfer({ amountWei: requestedWei, token, destination: normalizedDestination });

    await store.debitLedger({
      merchantAddress: normalizedMerchant,
      networkIndex,
      amountWei: requestedWei,
      token,
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

// GET: payout history for a merchant. Dashboard session or bearer secret.
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

  const payouts = await store.listPayoutsFor(normalizedTo, networkIndex);
  return NextResponse.json({
    payouts: payouts.map((p) => ({ ...p, amountWei: p.amountWei.toString() })),
  });
}
