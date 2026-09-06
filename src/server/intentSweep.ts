// Settling open intents when nobody is watching.
//
// settleIntentFromChain only runs when something calls it, and until now the
// only caller in the normal path was the payer's own checkout tab. That made
// the tab load-bearing: close it, lock the phone, or hit the wallet bug where
// strk20InvokeTransaction never resolves, and the note sat on-chain
// unattributed until a human ran the reconcile script. A real 10 STRK payment
// on Sepolia sat that way — matched to its intent, never credited.
//
// So the sweep runs from the two places that don't depend on the payer: the
// merchant reading their own console, and a daily cron. Both are bounded —
// this touches the chain, and neither caller may hang on it.
import { settleIntentFromChain } from "@/server/attribution";
import { getStore } from "@/server/store";
import type { NetworkIndex } from "@/server/store/types";

// Leave the payer's own polling alone for a moment before sweeping behind it.
// Both paths are safe to race — claimShieldedNote is atomic — but there is no
// point paying for chain reads against an intent that is seconds old and
// already being watched.
const MIN_AGE_SECONDS = 45;

export type SweepOutcome = { swept: number; settled: number; errors: number };

/**
 * Try to settle intents that are old enough that nobody is likely still
 * watching them.
 *
 * `merchantAddress` narrows it to one merchant's own payments, which is what
 * a console read should pay for; the cron omits it and sweeps everything.
 * `budgetMs` is a ceiling, not a target — the sweep stops early rather than
 * making a caller wait, and whatever it misses is picked up next time.
 */
export async function sweepOpenIntents(opts: {
  networkIndex: NetworkIndex;
  merchantAddress?: string;
  limit?: number;
  budgetMs?: number;
}): Promise<SweepOutcome> {
  const { networkIndex, merchantAddress, limit = 10, budgetMs = 4_000 } = opts;
  const deadline = Date.now() + budgetMs;
  const outcome: SweepOutcome = { swept: 0, settled: 0, errors: 0 };

  let intents;
  try {
    intents = await getStore().listOpenPaymentIntents(networkIndex);
  } catch {
    // A sweep is opportunistic. It must never be the reason a merchant cannot
    // read their own console.
    outcome.errors += 1;
    return outcome;
  }

  const cutoff = Date.now() / 1000 - MIN_AGE_SECONDS;
  const due = intents
    .filter((i) => i.createdAt <= cutoff)
    .filter((i) => !merchantAddress || i.merchantAddress === merchantAddress)
    // Oldest first: the ones most likely to have been abandoned by their tab.
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, limit);

  for (const intent of due) {
    if (Date.now() > deadline) break;
    outcome.swept += 1;
    try {
      const result = await settleIntentFromChain(intent.id);
      if (result.settled && !result.alreadySettled) outcome.settled += 1;
    } catch {
      outcome.errors += 1;
    }
  }

  return outcome;
}
