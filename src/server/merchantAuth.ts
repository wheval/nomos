import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/server/store";
import { clientIpFromHeaders, ipIsAllowed } from "@/utils/ipAllowlist";

// Dashboard login is the connected wallet, not an API key. This cookie is
// the same-origin session for console pages. Secret API keys remain the
// credential for server-to-server calls (Paystack/Stripe model).
export const SESSION_COOKIE = "nomos_session";
const TTL_SECONDS = 60 * 60 * 24 * 14;

type SessionPayload = { a: string; n: number; exp: number };

function sessionSecret(): string {
  return process.env.NOMOS_SESSION_SECRET || process.env.NOMOS_SHIELD_WORKER_SECRET || "nomos-dev-session";
}

export function encodeSession(address: string, networkIndex: number, now = Date.now()): string {
  const payload: SessionPayload = {
    a: address.toLowerCase(),
    n: networkIndex,
    exp: Math.floor(now / 1000) + TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function decodeSession(token: string, now = Date.now()): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.a !== "string" || typeof payload.n !== "number" || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function applySessionCookie(res: NextResponse, address: string, networkIndex: number): void {
  res.cookies.set(SESSION_COOKIE, encodeSession(address, networkIndex), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function bearerSecret(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

export async function isMerchantAuthorized(opts: {
  request: NextRequest;
  address: string;
  networkIndex: number;
  secretKey?: string | null;
}): Promise<"ok" | "unauthorized" | "ip"> {
  const fromBody = opts.secretKey && opts.secretKey.length > 0 ? opts.secretKey : "";
  const key = fromBody || bearerSecret(opts.request);
  if (key) {
    const ok = await getStore().verifyMerchantSecret(opts.address, key, opts.networkIndex);
    if (!ok) return "unauthorized";
    const profile = await getStore().getMerchantProfile(opts.address, opts.networkIndex);
    if (!ipIsAllowed(clientIpFromHeaders(opts.request.headers), profile.allowedIps)) return "ip";
    return "ok";
  }
  const token = opts.request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return "unauthorized";
  const session = decodeSession(token);
  if (!session) return "unauthorized";
  if (session.a === opts.address.toLowerCase() && session.n === opts.networkIndex) return "ok";
  return "unauthorized";
}

export async function unauthorizedUnlessMerchant(opts: {
  request: NextRequest;
  address: string;
  networkIndex: number;
  secretKey?: string | null;
}): Promise<NextResponse | null> {
  const result = await isMerchantAuthorized(opts);
  if (result === "ok") return null;
  if (result === "ip") {
    return NextResponse.json(
      { error: "This API key is not allowed from your IP. Add it under Settings → IP allowlist." },
      { status: 403 }
    );
  }
  return NextResponse.json(
    { error: "Connect your wallet to the dashboard, or pass a secret API key." },
    { status: 401 }
  );
}
