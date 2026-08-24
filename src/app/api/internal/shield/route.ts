import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { deliverPaymentWebhook } from "@/utils/webhook";

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

// GET: list deposits waiting to be manually shielded, and the total wei
// that needs shielding in one batch.
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const store = getStore();
  const deposits = await store.listPendingShieldDeposits();
  const totalWei = deposits.reduce((sum, d) => sum + d.amountWei, 0n);

  return NextResponse.json({
    deposits: deposits.map((d) => ({ ...d, amountWei: d.amountWei.toString() })),
    totalWei: totalWei.toString(),
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
      await store.creditLedger({
        merchantAddress: deposit.merchantAddress,
        amountWei: deposit.amountWei,
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
