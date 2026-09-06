import { NextRequest, NextResponse } from "next/server";
import { sweepOpenIntents } from "@/server/intentSweep";
import { Strk20Networks } from "@/utils/constants";
import type { NetworkIndex } from "@/server/store/types";

// The backstop. A merchant reading their console sweeps their own payments
// (see server/intentSweep.ts), which covers every merchant who is paying
// attention; this covers the one who is not, and anything the console read
// ran out of budget for.
//
// Vercel invokes crons with GET and, when CRON_SECRET is set, an
// `Authorization: Bearer $CRON_SECRET` header — so this authenticates on
// CRON_SECRET rather than the shield worker secret, and falls back to it so
// the route can still be triggered by hand during a test.
//
// On Hobby this runs once a day, which is why it is the backstop and not the
// mechanism. If Nomos moves to Pro, drop the schedule in vercel.json to
// every few minutes and this becomes the primary path.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const workerSecret = process.env.NOMOS_SHIELD_WORKER_SECRET;
  if (cronSecret && header === `Bearer ${cronSecret}`) return true;
  if (workerSecret && header === `Bearer ${workerSecret}`) return true;
  return false;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Invalid or missing Authorization header." }, { status: 401 });
  }

  // Every configured network, not just the default one — a cron that silently
  // only ever swept Sepolia would be worse than no cron at all.
  const networks = Object.keys(Strk20Networks).map(Number) as NetworkIndex[];
  const results: Record<string, unknown> = {};

  for (const networkIndex of networks) {
    try {
      results[Strk20Networks[networkIndex]] = await sweepOpenIntents({
        networkIndex,
        limit: 50,
        budgetMs: 20_000,
      });
    } catch (err) {
      results[Strk20Networks[networkIndex]] = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
