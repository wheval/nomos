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
  const discovery = getNoteDiscoveryClient(networkIndex);

  const unattributedNotes: { token: string; amount: string; noteId: string }[] = [];
  const discoveryErrors: string[] = [];
  for (const token of TokenSymbols) {
    const address = tokenAddressFor(token, networkIndex);
    if (address === "0x0") continue;
    try {
      for (const note of await discovery.listNotes({ tokenAddress: address })) {
        if (claimed.has(note.id)) continue;
        unattributedNotes.push({ token, amount: fmt(note.amount, token), noteId: note.id });
      }
    } catch (err) {
      // A token whose discovery fails must not hide the tokens that worked.
      discoveryErrors.push(`${token}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Flow B. A public transfer into the operating wallet with no deposit row
  // is the same failure in the other flow, and is checkable straight from
  // chain events.
  const unattributedTransfers: { token: string; amount: string; txHash: string; block?: number }[] = [];
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
          unattributedTransfers.push({
            token,
            amount: fmt(num.toBigInt(low), token),
            txHash: ev.transaction_hash,
            block: ev.block_number,
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
    errors: discoveryErrors,
  });
}

