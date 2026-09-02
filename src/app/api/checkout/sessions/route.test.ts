import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MERCHANT = "0x0000000000000000000000000000000000000000000000000000000000000abc";

let created: Record<string, unknown> | null = null;
const createPaymentLink = vi.fn(async (input: Record<string, unknown>) => {
  created = input;
  return { id: "sess-1", createdAt: 1700000000, ...input };
});

vi.mock("@/server/store", () => ({ getStore: () => ({ createPaymentLink }) }));

let denied: unknown = null;
const unauthorizedUnlessMerchant = vi.fn(async () => denied);
vi.mock("@/server/merchantAuth", () => ({ unauthorizedUnlessMerchant }));

const { POST } = await import("./route");

const body = (over: Record<string, unknown> = {}) => ({
  merchantAddress: MERCHANT,
  secretKey: "sk_test",
  networkIndex: 2,
  token: "USDC",
  amount: "25",
  ...over,
});

const req = (b: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/checkout/sessions", {
    method: "POST",
    body: JSON.stringify(b),
    headers: { "content-type": "application/json", ...headers },
  });

beforeEach(() => {
  vi.clearAllMocks();
  created = null;
  denied = null;
});

describe("POST /api/checkout/sessions", () => {
  it("returns a payable url, which is the whole point of a session", async () => {
    const res = await POST(req(body()));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.url).toBe(`http://localhost/pay?id=${data.id}`);
    expect(data.status).toBe("open");
  });

  it("is single-use and short-lived by default, unlike a payment link", async () => {
    const before = Math.floor(Date.now() / 1000);
    await POST(req(body()));
    expect(created!.singleUse).toBe(true);
    // Default expiry is 30 minutes — a cart does not outlive that.
    const expiresAt = created!.expiresAt as number;
    expect(expiresAt).toBeGreaterThan(before + 29 * 60);
    expect(expiresAt).toBeLessThanOrEqual(before + 31 * 60);
  });

  it("carries the merchant's own order id through as the reference", async () => {
    await POST(req(body({ reference: "order_9182" })));
    expect(created!.ref).toBe("order_9182");
  });

  it("requires an amount — an open-amount checkout is a contradiction", async () => {
    const res = await POST(req({ ...body(), amount: undefined }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/amount is required/i);
  });

  it("refuses an amount below the minimum payment", async () => {
    const res = await POST(req(body({ amount: "0.10" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Minimum payment/i);
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it("rejects a callbackUrl that is not http(s)", async () => {
    // The customer is redirected here, so javascript: would be an XSS vector
    // handed to us by an authenticated merchant.
    const res = await POST(req(body({ callbackUrl: "javascript:alert(1)" })));
    expect(res.status).toBe(400);
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it("accepts an https callbackUrl", async () => {
    const res = await POST(req(body({ callbackUrl: "https://shop.example/thanks" })));
    expect(res.status).toBe(201);
    expect(created!.callbackUrl).toBe("https://shop.example/thanks");
  });

  it("caps how long a session can stay payable", async () => {
    const res = await POST(req(body({ expiresIn: 60 * 60 * 48 })));
    expect(res.status).toBe(400);
  });

  it("builds the url from the proxy's host, not the internal one", async () => {
    // Behind Vercel the request URL is internal; redirecting a customer there
    // would send them nowhere.
    const res = await POST(
      req(body(), { "x-forwarded-host": "pay.nomos.app", "x-forwarded-proto": "https" })
    );
    expect((await res.json()).url).toBe("https://pay.nomos.app/pay?id=sess-1");
  });

  it("does not create a session when authorisation fails", async () => {
    denied = new Response(JSON.stringify({ error: "nope" }), { status: 401 });
    const res = await POST(req(body()));
    expect(res.status).toBe(401);
    expect(createPaymentLink).not.toHaveBeenCalled();
  });
});
