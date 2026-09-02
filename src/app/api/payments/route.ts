import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { unauthorizedUnlessMerchant } from "@/server/merchantAuth";
import { getStore } from "@/server/store";
import { netAfterFee, transactionFeeWei } from "@/utils/fees";
import { getNoteDiscoveryClient } from "@/server/signer/noteDiscovery";
import { deliverPaymentWebhook } from "@/utils/webhook";
import { verifyFlowADeposit, verifyFlowBDeposit } from "@/utils/verifyTx";
import { isTokenSymbol, isValidNetworkIndex, tokenAddressFor, TokenSymbols } from "@/utils/constants";

function operatingWalletAddress(): string {
  const addr = process.env.NOMOS_OPERATING_WALLET_ADDRESS;
  if (!addr) throw new Error("NOMOS_OPERATING_WALLET_ADDRESS is not configured.");
  return addr;
}

// Records a completed payment against a Payment Link, after verifying it
// actually happened on-chain — Flow A (private transfer) and Flow B
// (public transfer) verify differently; see src/utils/verifyTx.ts. Flow A
// credits the merchant's ledger immediately (funds are already shielded);
// Flow B is left pending_shield until the shield-step worker (Phase 5)
// confirms shielding and credits it then.
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { flow, merchantAddress, amountWei, token: tokenRaw, txHash, networkIndex: networkIndexClaim, note, ref, linkId } = body ?? {};
  // merchantAddress is only required without a linkId. A link already names
  // its merchant authoritatively, and checkout no longer receives the address
  // at all — it is not the payer's business who the merchant's wallet is.
  const hasLinkId = typeof linkId === "string" && linkId.length > 0;
  if (
    (flow !== "A" && flow !== "B") ||
    (!hasLinkId && typeof merchantAddress !== "string") ||
    typeof amountWei !== "string" ||
    typeof txHash !== "string" ||
    !isValidNetworkIndex(networkIndexClaim)
  ) {
    return NextResponse.json(
      { error: "flow ('A'|'B'), amountWei, txHash, networkIndex and (without linkId) merchantAddress are required." },
      { status: 400 }
    );
  }
  // Links created before multi-token support carry no token — treat as STRK.
  const tokenClaim = tokenRaw === undefined ? "STRK" : tokenRaw;
  if (!isTokenSymbol(tokenClaim)) {
    return NextResponse.json({ error: `token must be one of: ${TokenSymbols.join(", ")}.` }, { status: 400 });
  }

  // Placeholder when a link will supply the real one below; validated
  // strictly whenever the client is actually the source of truth.
  let normalizedMerchantClaim = "";
  if (typeof merchantAddress === "string") {
    try {
      normalizedMerchantClaim = validateAndParseAddress(merchantAddress);
    } catch {
      return NextResponse.json({ error: "merchantAddress is not a valid Starknet address." }, { status: 400 });
    }
  }

  const store = getStore();

  // A persisted Payment Link is the authoritative source for who gets
  // credited — the client's own merchantAddress/token/note/ref claims are
  // only trusted when there's no link to check them against (a raw,
  // pre-persistence link, or the embeddable widget's direct-address mode).
  // Without this, a client could POST any merchantAddress it wants and have
  // a real on-chain payment credited to the wrong account.
  let normalizedMerchant = normalizedMerchantClaim;
  let token = tokenClaim;
  let networkIndex = networkIndexClaim;
  let linkNote: string | undefined = typeof note === "string" ? note : undefined;
  let linkRef: string | undefined = typeof ref === "string" ? ref : undefined;
  let paidLinkId: string | undefined;
  if (linkId !== undefined) {
    if (typeof linkId !== "string") {
      return NextResponse.json({ error: "linkId must be a string." }, { status: 400 });
    }
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
    if (!isTokenSymbol(link.token)) {
      return NextResponse.json({ error: "Payment link has an invalid token." }, { status: 500 });
    }
    // An invoice is payable once. Reject a second payer before they spend
    // gas, rather than silently accepting money against a settled invoice.
    // A failed attempt (rejected/shield_failed) must not close it.
    if (link.singleUse) {
      const already = await store.listDepositsForLink(link.id);
      const settled = already.filter((d) => d.status !== "rejected" && d.status !== "shield_failed");
      if (settled.length > 0) {
        return NextResponse.json(
          { error: "This invoice has already been paid.", alreadyPaid: true },
          { status: 409 }
        );
      }
    }
    paidLinkId = link.id;
    normalizedMerchant = link.merchantAddress;
    token = link.token;
    // The link's own network is authoritative, not whatever the client
    // claims - a test-mode link must always verify against Sepolia, a
    // live-mode link always against Mainnet, regardless of client input.
    networkIndex = link.networkIndex;
    linkNote = link.note;
    linkRef = link.ref;
  }

  let claimedAmountWei: bigint;
  try {
    claimedAmountWei = BigInt(amountWei);
    if (claimedAmountWei <= 0n) throw new Error();
  } catch {
    return NextResponse.json({ error: "amountWei must be a positive integer string (wei)." }, { status: 400 });
  }

  const existing = await store.getDepositByTxHash(txHash);
  if (existing) {
    return NextResponse.json(
      { ok: true, status: existing.status, reference: existing.reference, alreadyRecorded: true },
      { status: 200 }
    );
  }

  const tokenAddress = tokenAddressFor(token, networkIndex);

  let verified: Awaited<ReturnType<typeof verifyFlowBDeposit>>;
  if (flow === "B") {
    let operatingWallet: string;
    try {
      operatingWallet = operatingWalletAddress();
    } catch (err: any) {
      return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
    }
    verified = await verifyFlowBDeposit({
      txHash,
      operatingWalletAddress: operatingWallet,
      tokenAddress,
      claimedAmountWei,
      networkIndex,
    });
  } else {
    verified = await verifyFlowADeposit({
      txHash,
      claimedAmountWei,
      tokenAddress,
      networkIndex,
      discovery: getNoteDiscoveryClient(networkIndex),
      // Claiming before the deposit is recorded is deliberate: if recording
      // then failed we would leave a note locked, which is recoverable, where
      // the reverse order risks crediting the same note twice.
      claimNote: (noteId) => store.claimShieldedNote(noteId, networkIndex),
    });
  }

  if (!verified.ok) {
    return NextResponse.json({ error: `Could not verify deposit: ${verified.reason}` }, { status: 422 });
  }

  // Unreachable by construction — a linkId either resolves to a merchant or
  // 404s above, and without one merchantAddress was required. Asserted anyway
  // because this is the last point before money is credited to an account.
  if (!normalizedMerchant) {
    return NextResponse.json({ error: "Could not resolve the merchant for this payment." }, { status: 400 });
  }

  // Priced off the verified on-chain amount, not the client's claim, and
  // charged per flow: Flow B costs Nomos an extra shield, so it costs more.
  const feeWei = transactionFeeWei(token, flow);

  const { deposit } = await store.recordDeposit({
    merchantAddress: normalizedMerchant,
    networkIndex,
    flow,
    txHash,
    amountWei: verified.amountWei,
    feeWei,
    token,
    note: linkNote,
    ref: linkRef,
    reference: typeof body?.reference === "string" && body.reference.trim() ? body.reference.trim() : undefined,
    linkId: paidLinkId,
    status: flow === "A" ? "verified" : "pending_shield",
  });

  if (flow === "A") {
    // Credited net. The deposit row keeps the gross, so the merchant can
    // always see what was paid alongside what they were charged.
    await store.creditLedger({
      merchantAddress: normalizedMerchant,
      networkIndex,
      amountWei: netAfterFee(verified.amountWei, deposit.feeWei),
      token,
      kind: "flow_a_deposit",
      depositId: deposit.id,
    });
    await deliverPaymentWebhook(deposit);
  }
  // Flow B is credited (and its webhook fired) by the shield-step worker
  // once shielding is confirmed — see Phase 5.

  return NextResponse.json(
    { ok: true, status: deposit.status, reference: deposit.reference },
    { status: 201 }
  );
}

// Lists recorded deposits + the current ledger balance for a merchant.
// Dashboard session (connected wallet) or bearer secret API key.
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

  const [deposits, balances] = await Promise.all([
    store.listDepositsFor(normalizedTo, networkIndex),
    Promise.all(TokenSymbols.map(async (t) => [t, await store.getLedgerBalance(normalizedTo, t, networkIndex)] as const)),
  ]);

  return NextResponse.json({
    deposits: deposits.map((d) => ({ ...d, amountWei: d.amountWei.toString(), feeWei: (d.feeWei ?? 0n).toString() })),
    balances: Object.fromEntries(balances.map(([t, wei]) => [t, wei.toString()])),
  });
}
