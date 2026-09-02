// One-time registration of the operating wallet's viewing key on a network's
// STRK20 pool. Nothing — Flow A verification, private payouts — works until
// this has happened, because an unregistered account cannot hold notes.
//
// This lives behind an API route rather than in a script so it runs through
// the real per-network wiring in server/signer: the mainnet path needs the
// Starkscan relay proof provider, and duplicating that into a standalone
// script would mean two implementations of the thing most likely to break.
//
// Idempotent: an already-registered wallet returns ok without spending.
import { NextRequest, NextResponse } from "next/server";
import { num } from "starknet";
import { isValidNetworkIndex, myFrontendProviders } from "@/utils/constants";
import { getOperatingAccount } from "@/server/signer/operatingWallet";
import {
  getPrivacyClient,
  poolAddressFor,
  provingBlockId,
  submitPrivateAction,
} from "@/server/signer/privacyClient";

// Reuses the shield worker's secret rather than adding another one: both are
// the same trust level — an operator acting on Nomos's own wallet.
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

async function isRegistered(
  provider: (typeof myFrontendProviders)[number],
  networkIndex: number,
  address: string
): Promise<boolean> {
  try {
    const res = await provider.callContract({
      contractAddress: poolAddressFor(networkIndex),
      entrypoint: "get_public_key",
      calldata: [address],
    });
    return res.some((v) => num.toBigInt(v) !== 0n);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const denied = requireAuth(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const networkIndex = (body as { networkIndex?: unknown } | null)?.networkIndex;
  if (!isValidNetworkIndex(networkIndex)) {
    return NextResponse.json({ error: "networkIndex must be 0 (mainnet) or 2 (sepolia)." }, { status: 400 });
  }

  const provider = myFrontendProviders[networkIndex];
  if (!provider) {
    return NextResponse.json({ error: `No RPC provider for network index ${networkIndex}.` }, { status: 500 });
  }

  try {
    const account = getOperatingAccount(provider, networkIndex);

    if (await isRegistered(provider, networkIndex, account.address)) {
      return NextResponse.json({ ok: true, alreadyRegistered: true, address: account.address });
    }

    const transfers = getPrivacyClient(provider, networkIndex);
    const blockId = await provingBlockId(provider);
    const result = await transfers.build({ provingBlockId: blockId }).register().execute();
    const { txHash } = await submitPrivateAction(account, result, provider);
    await provider.waitForTransaction(txHash);

    return NextResponse.json({ ok: true, alreadyRegistered: false, address: account.address, txHash }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

// GET: readiness without spending anything — same check the setup script runs.
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

  const address = process.env.NOMOS_OPERATING_WALLET_ADDRESS ?? null;
  if (!address) {
    return NextResponse.json({ error: "NOMOS_OPERATING_WALLET_ADDRESS is not configured." }, { status: 500 });
  }

  let deployed = true;
  try {
    await provider.getClassHashAt(address, "latest");
  } catch {
    deployed = false;
  }

  return NextResponse.json({
    networkIndex,
    address,
    deployed,
    registered: await isRegistered(provider, networkIndex, address),
    pool: poolAddressFor(networkIndex),
  });
}
