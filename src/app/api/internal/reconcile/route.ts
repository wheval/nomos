// Finds money that reached the operating wallet but was never credited.
//
// Recording a payment depends on the payer's browser reaching /api/payments
// after the wallet broadcasts. That call now retries, but a closed tab, a dead
// network or a crashed page still ends with real funds in custody and no
// deposit row — which is exactly how a customer once paid twice and the
// merchant saw nothing. Client-side reporting cannot be made reliable enough
// to be the only record; this is the backstop that makes the loss detectable.
//
// It reports, it never credits. Attribution needs a human: an unclaimed note
// proves money arrived, not who it was for.
import { NextRequest, NextResponse } from "next/server";
import { hash, num } from "starknet";
import { getStore } from "@/server/store";
import type { PaymentIntent } from "@/server/store/types";
import {
  isValidNetworkIndex,
  myFrontendProviders,
  operatingWalletAddress,
  tokenAddressFor,
  tokenDecimals,
  TokenSymbols,
  type TokenSymbol,
} from "@/utils/constants";
import { getNoteDiscoveryClient } from "@/server/signer/noteDiscovery";

const TRANSFER_SELECTOR = num.toHex(hash.getSelectorFromName("Transfer"));

// Far enough back to cover a long outage without asking the RPC for the whole
// chain. Flow B deposits are normally reconciled within minutes.
const LOOKBACK_BLOCKS = 5_000;

function requireAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.NOMOS_SHIELD_WORKER_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "NOMOS_SHIELD_WORKER_SECRET is not configured." }, { status: 500 });
  }
  if ((request.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Invalid or missing Authorization header." }, { status: 401 });
  }
  return null;
}

/**
 * Which open intent does this arrival belong to?
 *
 * Matched on the only things an arrival can be compared against: network,
 * token and exact amount. Returns a single intent or nothing — never a guess.
 *
 * Ambiguity is left unresolved on purpose. Two merchants with identical
 * 1.5 USDC links produce indistinguishable arrivals, and crediting the wrong
 * one is worse than crediting neither: the money is still safe and still
 * visible, and a human can attribute it. Automatic attribution is only safe
 * where it is certain.
 */
function soleMatchingIntent(
  intents: PaymentIntent[],
  token: string,
  amountWei: bigint,
  // Intents already paired with an earlier arrival in this sweep. One intent
  // is one payment, so it cannot back two arrivals — without this, two
  // identical 1 USDC notes both matched the same intent and the sweep reported
  // two attributable payments where there was only ever one.
  consumed: Set<string>
): PaymentIntent | null {
  const candidates = intents.filter(
    (i) => i.token === token && i.amountWei === amountWei && !consumed.has(i.id)
  );
  if (candidates.length !== 1) return null;
  consumed.add(candidates[0].id);
  return candidates[0];
}

const fmt = (wei: bigint, token: TokenSymbol) => `${Number(wei) / 10 ** tokenDecimals(token)} ${token}`;

export async function GET(request: NextRequest) {
  const denied = requireAuth(request);
  if (denied) return denied;

  const raw = request.nextUrl.searchParams.get("network");
  const networkIndex = raw === null ? 2 : Number(raw);
  if (!isValidNetworkIndex(networkIndex)) {
    return NextResponse.json({ error: "network must be 0 (mainnet) or 2 (sepolia)." }, { status: 400 });
  }
  const provider = myFrontendProviders[networkIndex];
  if (!provider) {
    return NextResponse.json({ error: `No RPC provider for network index ${networkIndex}.` }, { status: 500 });
  }

  const store = getStore();

  // Flow A. A shielded note the operating wallet holds that no deposit has
  // claimed is a private payment nobody was credited for. The claim table is
  // the same one verification writes to, so "unclaimed" means precisely "no
  // deposit settled against this".
  const claimed = await store.listClaimedNoteIds(networkIndex);
  const openIntents = await store.listOpenPaymentIntents(networkIndex);
  // Shared across both flows: an intent paired with a note must not also be
  // offered to a transfer.
  const consumedIntents = new Set<string>();
  const discovery = getNoteDiscoveryClient(networkIndex);

  const unattributedNotes: {
    token: string;
    amount: string;
    noteId: string;
    // The intent this arrival belongs to, when exactly one matches. Present
    // means it can be credited automatically; null means a human decides.
    intentId: string | null;
    linkId?: string;
    merchantAddress?: string;
  }[] = [];
  const discoveryErrors: string[] = [];
  for (const token of TokenSymbols) {
    const address = tokenAddressFor(token, networkIndex);
    if (address === "0x0") continue;
    try {
      for (const note of await discovery.listNotes({ tokenAddress: address })) {
        if (claimed.has(note.id)) continue;
        const intent = soleMatchingIntent(openIntents, token, note.amount, consumedIntents);
        unattributedNotes.push({
          token,
          amount: fmt(note.amount, token),
          noteId: note.id,
          intentId: intent?.id ?? null,
          linkId: intent?.linkId,
          merchantAddress: intent?.merchantAddress,
        });
      }
    } catch (err) {
      // A token whose discovery fails must not hide the tokens that worked.
      discoveryErrors.push(`${token}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Flow B. A public transfer into the operating wallet with no deposit row
  // is the same failure in the other flow, and is checkable straight from
  // chain events.
  const unattributedTransfers: {
    token: string;
    amount: string;
    txHash: string;
    block?: number;
    intentId: string | null;
    linkId?: string;
    merchantAddress?: string;
  }[] = [];
  if (operatingWalletAddress !== "0x0") {
    const head = await provider.getBlockNumber();
    const operating = num.toBigInt(operatingWalletAddress);
    for (const token of TokenSymbols) {
      const address = tokenAddressFor(token, networkIndex);
      if (address === "0x0") continue;
      try {
        const { events } = await provider.getEvents({
          address,
          keys: [[TRANSFER_SELECTOR]],
          from_block: { block_number: Math.max(0, head - LOOKBACK_BLOCKS) },
          to_block: "latest",
          chunk_size: 1000,
        });
        for (const ev of events) {
          // Both Transfer shapes, same as verifyFlowBDeposit.
          const indexed = ev.keys.length >= 3;
          const to = indexed ? ev.keys[2] : ev.data[1];
          const low = indexed ? ev.data[0] : ev.data[2];
          if (to === undefined || low === undefined) continue;
          if (num.toBigInt(to) !== operating) continue;
          if (await store.getDepositByTxHash(ev.transaction_hash)) continue;
          const amount = num.toBigInt(low);
          const intent = soleMatchingIntent(openIntents, token, amount, consumedIntents);
          unattributedTransfers.push({
            token,
            amount: fmt(amount, token),
            txHash: ev.transaction_hash,
            block: ev.block_number,
            intentId: intent?.id ?? null,
            linkId: intent?.linkId,
            merchantAddress: intent?.merchantAddress,
          });
        }
      } catch (err) {
        discoveryErrors.push(`${token} transfers: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return NextResponse.json({
    networkIndex,
    operatingWallet: operatingWalletAddress,
    // Shielded funds held with no deposit behind them.
    unattributedNotes,
    // Public transfers received with no deposit behind them.
    unattributedTransfers,
    clean: unattributedNotes.length === 0 && unattributedTransfers.length === 0,
    // Arrivals that can be credited without a human, because exactly one
    // open intent matches them.
    attributable:
      unattributedNotes.filter((n) => n.intentId).length +
      unattributedTransfers.filter((t) => t.intentId).length,
    openIntents: openIntents.length,
    errors: discoveryErrors,
  });
}


/**
 * Credits the arrivals that GET reported as attributable.
 *
 * Flow B is fully automatic and needs no browser at all: a public transfer
 * carries its own transaction hash, so /api/payments can verify it on-chain
 * exactly as it would a client-reported one.
 *
 * Flow A cannot be: a shielded note has no transaction hash to verify against,
 * and deposits are keyed by hash. So a note whose intent is known is reported
 * here for a human to finish, rather than credited on an amount match alone —
 * amount is not proof, and this is money.
 */
export async function POST(request: NextRequest) {
  const denied = requireAuth(request);
  if (denied) return denied;

  const raw = request.nextUrl.searchParams.get("network");
  const networkIndex = raw === null ? 2 : Number(raw);
  if (!isValidNetworkIndex(networkIndex)) {
    return NextResponse.json({ error: "network must be 0 (mainnet) or 2 (sepolia)." }, { status: 400 });
  }

  // Reuse the read path verbatim so POST can never act on a different view of
  // the world than GET reported.
  const survey = await GET(request);
  const state = (await survey.json()) as {
    unattributedTransfers?: { txHash: string; intentId: string | null }[];
    unattributedNotes?: { noteId: string; intentId: string | null; amount: string }[];
    error?: string;
  };
  if (state.error) return NextResponse.json(state, { status: survey.status });

  const origin = request.nextUrl.origin;
  const credited: { txHash: string; reference?: string; error?: string }[] = [];

  for (const transfer of state.unattributedTransfers ?? []) {
    if (!transfer.intentId) continue;
    const intent = (await getStore().listOpenPaymentIntents(networkIndex)).find(
      (i) => i.id === transfer.intentId
    );
    if (!intent) continue;
    try {
      // Through the ordinary endpoint, so on-chain verification, fee pricing
      // and ledger crediting all behave identically to a normal payment.
      const res = await fetch(`${origin}/api/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow: "B",
          amountWei: intent.amountWei.toString(),
          token: intent.token,
          txHash: transfer.txHash,
          networkIndex,
          linkId: intent.linkId,
          intentId: intent.id,
        }),
      });
      const body = (await res.json()) as { reference?: string; error?: string };
      credited.push({ txHash: transfer.txHash, reference: body.reference, error: body.error });
    } catch (err) {
      credited.push({ txHash: transfer.txHash, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    networkIndex,
    credited,
    // Shielded arrivals with a known intent but no hash to verify. Named so an
    // operator can act on them rather than discovering them later.
    needsOperator: (state.unattributedNotes ?? []).filter((n) => n.intentId),
  });
}
