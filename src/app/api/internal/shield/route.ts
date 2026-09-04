import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { deliverPaymentWebhook } from "@/utils/webhook";
import { netAfterFee } from "@/utils/fees";

// Manual shield reconciliation — not an automated worker. Flow B deposits
// can't be shielded headlessly: every deposit into the STRK20 pool needs a
// screening signature from FPI, and self-hosting a prover doesn't bypass
// it (see docs/ARCHITECTURE.md "New constraint found: deposits are
// screened"). The actual shield step is a team member manually shielding
// through their own privacy-capable wallet (Ready/Xverse) and privately
// transferring the result into the operating wallet — this route is just
// the bookkeeping half: list what's waiting, then mark it done once
// that's happened.
function requireAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.NOMOS_SHIELD_WORKER_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "NOMOS_SHIELD_WORKER_SECRET is not configured." }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Invalid or missing Authorization header." }, { status: 401 });
  }
  return null;
}

// GET: what is waiting to be shielded, grouped by what can actually be
// shielded together.
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const store = getStore();
  const deposits = await store.listPendingShieldDeposits();

  // Grouped by network and token. A single total across everything was
  // meaningless — it added 1 USDC (1e6) to 1 STRK (1e18) — and it is also not
  // what an operator needs: one shield action covers one token on one network,
  // so the batch is the group.
  const groups = new Map<string, { networkIndex: number; token: string; totalWei: bigint; depositIds: string[] }>();
  for (const d of deposits) {
    const key = `${d.networkIndex}:${d.token}`;
    const group = groups.get(key) ?? { networkIndex: d.networkIndex, token: d.token, totalWei: 0n, depositIds: [] };
    group.totalWei += d.amountWei;
    group.depositIds.push(d.id);
    groups.set(key, group);
  }

  return NextResponse.json({
    // The server-side variable, not the NEXT_PUBLIC_ mirror. This address is
    // where an operator is about to send real money by hand, so it comes from
    // the same source the signer itself uses.
    operatingWallet: process.env.NOMOS_OPERATING_WALLET_ADDRESS ?? null,
    deposits: deposits.map((d) => ({ ...d, amountWei: d.amountWei.toString(), feeWei: (d.feeWei ?? 0n).toString() })),
    groups: [...groups.values()].map((g) => ({ ...g, totalWei: g.totalWei.toString() })),
  });
}

// POST: mark a batch of deposits shielded after a team member has actually
// done the shield + private transfer by hand. Credits each deposit's
// merchant ledger and fires their webhook. shieldTxHash is shared across
// the whole batch if one shield action covered several deposits at once.
export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { depositIds, shieldTxHash } = body ?? {};
  if (!Array.isArray(depositIds) || depositIds.length === 0 || typeof shieldTxHash !== "string") {
    return NextResponse.json(
      { error: "depositIds (non-empty string array) and shieldTxHash are required." },
      { status: 400 }
    );
  }

  const store = getStore();
  const results: { depositId: string; ok: boolean; error?: string }[] = [];

  for (const depositId of depositIds) {
    try {
      const deposit = (await store.listPendingShieldDeposits()).find((d) => d.id === depositId);
      if (!deposit) {
        results.push({ depositId, ok: false, error: "Not found or not pending_shield." });
        continue;
      }
      await store.markDepositShielded(depositId, shieldTxHash);
      // Net, same as Flow A. The fee was fixed when the deposit was
      // recorded, so shielding later never reprices it.
      await store.creditLedger({
        merchantAddress: deposit.merchantAddress,
        networkIndex: deposit.networkIndex,
        amountWei: netAfterFee(deposit.amountWei, deposit.feeWei),
        token: deposit.token,
        kind: "flow_b_deposit",
        depositId: deposit.id,
      });
      await deliverPaymentWebhook({ ...deposit, status: "shielded", shieldTxHash });
      results.push({ depositId, ok: true });
    } catch (err: any) {
      results.push({ depositId, ok: false, error: err?.message ?? String(err) });
    }
  }

  return NextResponse.json({ results });
}
