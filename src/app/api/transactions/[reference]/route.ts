import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { unauthorizedUnlessMerchant } from "@/server/merchantAuth";
import { tokenDecimals, isTokenSymbol } from "@/utils/constants";

// Verify a payment by its reference — the step a merchant's server must run
// before delivering value.
//
// Nomos already verifies on-chain before recording anything, so this reports
// a settled fact rather than re-checking the chain. It exists because a
// webhook can be missed and a redirect proves nothing: this is the pull-side
// counterpart, so an integration always has a way to reconcile.
//
// Authorisation is resolved from the deposit's own merchant, never from a
// caller-supplied address — holding a reference is not authority to read it.
export async function GET(request: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;

  const store = getStore();
  const deposit = await store.getDepositByReference(reference);
  if (!deposit) {
    return NextResponse.json({ error: "No transaction with that reference." }, { status: 404 });
  }

  const denied = await unauthorizedUnlessMerchant({
    request,
    address: deposit.merchantAddress,
    networkIndex: deposit.networkIndex,
  });
  if (denied) return denied;

  // "Has the money arrived and is it the merchant's to spend?" — the single
  // question an integration needs answered. Flow B sits at pending_shield
  // until shielding confirms, so it is received but not yet credited.
  const succeeded = deposit.status === "verified" || deposit.status === "shielded";
  const failed = deposit.status === "rejected" || deposit.status === "shield_failed";

  return NextResponse.json({
    reference: deposit.reference,
    status: succeeded ? "success" : failed ? "failed" : "pending",
    depositStatus: deposit.status,
    // Compare this against what you charged before delivering value.
    amountWei: deposit.amountWei.toString(),
    decimals: isTokenSymbol(deposit.token) ? tokenDecimals(deposit.token) : undefined,
    token: deposit.token,
    flow: deposit.flow,
    txHash: deposit.txHash,
    networkIndex: deposit.networkIndex,
    linkId: deposit.linkId,
    note: deposit.note,
    ref: deposit.ref,
    recordedAt: deposit.recordedAt,
  });
}
