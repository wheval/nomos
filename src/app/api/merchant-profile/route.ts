import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { unauthorizedUnlessMerchant } from "@/server/merchantAuth";
import { getStore } from "@/server/store";
import { isValidNetworkIndex } from "@/utils/constants";
import { parseIpList } from "@/utils/ipAllowlist";

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
  const profile = await getStore().getMerchantProfile(normalized, networkIndex);
  return NextResponse.json(profile);
}

export async function POST(request: NextRequest) {
  let body: {
    address?: unknown;
    networkIndex?: unknown;
    displayName?: unknown;
    allowedIps?: unknown;
    secretKey?: unknown;
    logoDataUrl?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { address, networkIndex, displayName, allowedIps, secretKey, logoDataUrl } = body ?? {};
  if (typeof address !== "string") {
    return NextResponse.json({ error: "address is required." }, { status: 400 });
  }
  if (!isValidNetworkIndex(networkIndex)) {
    return NextResponse.json({ error: "networkIndex is required and must be a supported network." }, { status: 400 });
  }
  let normalized: string;
  try {
    normalized = validateAndParseAddress(address);
  } catch {
    return NextResponse.json({ error: "address is not a valid Starknet address." }, { status: 400 });
  }
  const denied = await unauthorizedUnlessMerchant({
    request,
    address: normalized,
    networkIndex,
    secretKey: typeof secretKey === "string" ? secretKey : null,
  });
  if (denied) return denied;

  const store = getStore();
  if (typeof displayName === "string") {
    if (displayName.trim().length > 80) {
      return NextResponse.json({ error: "Business name must be 80 characters or fewer." }, { status: 400 });
    }
    await store.setMerchantDisplayName(normalized, networkIndex, displayName);
  }
  if (allowedIps !== undefined) {
    if (!Array.isArray(allowedIps) || allowedIps.some((ip) => typeof ip !== "string")) {
      return NextResponse.json({ error: "allowedIps must be an array of IP strings." }, { status: 400 });
    }
    const parsed = parseIpList(allowedIps);
    if (parsed.invalid.length) {
      return NextResponse.json(
        { error: `Invalid IP${parsed.invalid.length > 1 ? "s" : ""}: ${parsed.invalid.join(", ")}.` },
        { status: 400 }
      );
    }
    await store.setMerchantAllowedIps(normalized, networkIndex, parsed.ips);
  }
  if (logoDataUrl !== undefined) {
    if (logoDataUrl === null || logoDataUrl === "") {
      await store.setMerchantLogo(normalized, networkIndex, null);
    } else if (typeof logoDataUrl !== "string" || !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(logoDataUrl)) {
      return NextResponse.json({ error: "Logo must be a PNG, JPEG, WebP, or GIF." }, { status: 400 });
    } else if (logoDataUrl.length > 180_000) {
      return NextResponse.json({ error: "Logo is too large — keep it under ~120KB." }, { status: 400 });
    } else {
      await store.setMerchantLogo(normalized, networkIndex, logoDataUrl);
    }
  }
  const profile = await store.getMerchantProfile(normalized, networkIndex);
  return NextResponse.json(profile);
}
