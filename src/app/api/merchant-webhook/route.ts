import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { unauthorizedUnlessMerchant } from "@/server/merchantAuth";
import { getStore } from "@/server/store";
import { isValidNetworkIndex } from "@/utils/constants";

// GET: the merchant's current webhook URL for the given network.
// Dashboard session or bearer secret — same as the rest of the console.
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const networkRaw = request.nextUrl.searchParams.get("network");
  if (!address) return NextResponse.json({ error: "Missing ?address=." }, { status: 400 });
  const networkIndex = networkRaw !== null ? Number(networkRaw) : NaN;
  if (!isValidNetworkIndex(networkIndex)) {
    return NextResponse.json({ error: "Missing or invalid ?network=." }, { status: 400 });
  }

  let normalized: string;
  try {
    normalized = validateAndParseAddress(address);
  } catch {
    return NextResponse.json({ error: "address is not a valid Starknet address." }, { status: 400 });
  }
  const denied = await unauthorizedUnlessMerchant({ request, address: normalized, networkIndex });
  if (denied) return denied;
  const store = getStore();
  const webhookUrl = await store.getMerchantWebhookUrl(normalized, networkIndex);
  return NextResponse.json({ webhookUrl });
}

// POST: set (or clear, with url: "") the webhook URL for the given network.
// Requires the secret key for that same network.
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { address, secretKey, url, networkIndex } = body ?? {};
  if (typeof address !== "string" || typeof secretKey !== "string" || typeof url !== "string") {
    return NextResponse.json({ error: "address, secretKey, and url are required." }, { status: 400 });
  }
  if (!isValidNetworkIndex(networkIndex)) {
    return NextResponse.json({ error: "networkIndex is required and must be a supported network." }, { status: 400 });
  }
  if (url && !/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: "url must start with http:// or https://" }, { status: 400 });
  }
  let normalized: string;
  try {
    normalized = validateAndParseAddress(address);
  } catch {
    return NextResponse.json({ error: "address is not a valid Starknet address." }, { status: 400 });
  }
  const ok = await getStore().setMerchantWebhookUrl(normalized, secretKey, url, networkIndex);
  if (!ok) return NextResponse.json({ error: "Invalid secret key for this address." }, { status: 401 });
  return NextResponse.json({ ok: true });
}
