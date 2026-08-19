import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { getMerchantWebhookUrl, setMerchantWebhookUrl, verifyMerchantSecret } from "@/utils/store";

// GET: the merchant's current webhook URL (requires their secret key - a
// webhook destination is as sensitive as the payments list it triggers on).
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const auth = request.headers.get("authorization") ?? "";
  const secretKey = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!address) return NextResponse.json({ error: "Missing ?address=." }, { status: 400 });

  let normalized: string;
  try {
    normalized = validateAndParseAddress(address);
  } catch {
    return NextResponse.json({ error: "address is not a valid Starknet address." }, { status: 400 });
  }
  if (!secretKey || !(await verifyMerchantSecret(normalized, secretKey))) {
    return NextResponse.json({ error: "Invalid or missing secret key." }, { status: 401 });
  }
  const webhookUrl = await getMerchantWebhookUrl(normalized);
  return NextResponse.json({ webhookUrl });
}

// POST: set (or clear, with url: "") the webhook URL. Requires the secret key.
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { address, secretKey, url } = body ?? {};
  if (typeof address !== "string" || typeof secretKey !== "string" || typeof url !== "string") {
    return NextResponse.json({ error: "address, secretKey, and url are required." }, { status: 400 });
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
  const ok = await setMerchantWebhookUrl(normalized, secretKey, url);
  if (!ok) return NextResponse.json({ error: "Invalid secret key for this address." }, { status: 401 });
  return NextResponse.json({ ok: true });
}
