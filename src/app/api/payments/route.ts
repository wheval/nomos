import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { unauthorizedUnlessMerchant } from "@/server/merchantAuth";
import { getStore } from "@/server/store";
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
  if (
    (flow !== "A" && flow !== "B") ||
    typeof merchantAddress !== "string" ||
    typeof amountWei !== "string" ||
    typeof txHash !== "string" ||
    !isValidNetworkIndex(networkIndexClaim)
  ) {
    return NextResponse.json(
      { error: "flow ('A'|'B'), merchantAddress, amountWei, txHash, and networkIndex are required." },
      { status: 400 }
    );
  }
  // Links created before multi-token support carry no token — treat as STRK.
  const tokenClaim = tokenRaw === undefined ? "STRK" : tokenRaw;
  if (!isTokenSymbol(tokenClaim)) {
    return NextResponse.json({ error: `token must be one of: ${TokenSymbols.join(", ")}.` }, { status: 400 });
  }

  let normalizedMerchantClaim: string;
  try {
    normalizedMerchantClaim = validateAndParseAddress(merchantAddress);
  } catch {
    return NextResponse.json({ error: "merchantAddress is not a valid Starknet address." }, { status: 400 });
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
    return NextResponse.json({ ok: true, status: existing.status, alreadyRecorded: true }, { status: 200 });
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
      discovery: getNoteDiscoveryClient(networkIndex),
    });
  }

  if (!verified.ok) {
    return NextResponse.json({ error: `Could not verify deposit: ${verified.reason}` }, { status: 422 });
  }

  const { deposit } = await store.recordDeposit({
    merchantAddress: normalizedMerchant,
    networkIndex,
    flow,
    txHash,
    amountWei: verified.amountWei,
    token,
    note: linkNote,
    ref: linkRef,
    status: flow === "A" ? "verified" : "pending_shield",
  });

  if (flow === "A") {
    await store.creditLedger({
      merchantAddress: normalizedMerchant,
      networkIndex,
      amountWei: verified.amountWei,
      token,
      kind: "flow_a_deposit",
      depositId: deposit.id,
    });
    await deliverPaymentWebhook(deposit);
  }
  // Flow B is credited (and its webhook fired) by the shield-step worker
  // once shielding is confirmed — see Phase 5.

  return NextResponse.json({ ok: true, status: deposit.status }, { status: 201 });
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
    deposits: deposits.map((d) => ({ ...d, amountWei: d.amountWei.toString() })),
    balances: Object.fromEntries(balances.map(([t, wei]) => [t, wei.toString()])),
  });
}
