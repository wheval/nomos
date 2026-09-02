import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MERCHANT = "0x0000000000000000000000000000000000000000000000000000000000000abc";

let link: Record<string, unknown> | null = null;
let deposits: Record<string, unknown>[] = [];
const getPaymentLink = vi.fn(async () => link);
const listDepositsForLink = vi.fn(async () => deposits);

vi.mock("@/server/store", () => ({ getStore: () => ({ getPaymentLink, listDepositsForLink }) }));

let denied: unknown = null;
const unauthorizedUnlessMerchant = vi.fn(async () => denied);
vi.mock("@/server/merchantAuth", () => ({ unauthorizedUnlessMerchant }));

const { GET } = await import("./route");

const params = { params: Promise.resolve({ id: "sess-1" }) };
const req = () => new NextRequest("http://localhost/api/checkout/sessions/sess-1");

const NOW = Math.floor(Date.now() / 1000);

function makeLink(over: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    merchantAddress: MERCHANT,
    networkIndex: 2,
    amountWei: 25_000_000n,
    token: "USDC",
    ref: "order_9182",
    note: "One t-shirt",
    revoked: false,
    expiresAt: NOW + 600,
    createdAt: NOW - 60,
    singleUse: true,
    ...over,
  };
}

function deposit(over: Record<string, unknown> = {}) {
  return {
    reference: "nx_abc",
    txHash: "0xtx",
    flow: "A",
    amountWei: 25_000_000n,
    feeWei: 100_000n,
    status: "verified",
    recordedAt: NOW - 10,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  link = makeLink();
  deposits = [];
  denied = null;
});

describe("GET /api/checkout/sessions/[id]", () => {
  it("is open with no payments yet", async () => {
    const data = await (await GET(req(), params)).json();
    expect(data.status).toBe("open");
    expect(data.payment).toBeNull();
    expect(data.reference).toBe("order_9182");
  });

  it("reports paid, with the net after the Nomos fee", async () => {
    deposits = [deposit()];
    const data = await (await GET(req(), params)).json();
    expect(data.status).toBe("paid");
    expect(data.payment).toMatchObject({
      reference: "nx_abc",
      txHash: "0xtx",
      amountWei: "25000000",
      feeWei: "100000",
      netWei: "24900000",
    });
  });

  it("counts a payment made just before expiry as paid, not expired", async () => {
    // The merchant must ship this order. A settled payment outranks the clock.
    link = makeLink({ expiresAt: NOW - 1 });
    deposits = [deposit()];
    expect((await (await GET(req(), params)).json()).status).toBe("paid");
  });

  it("reports processing while a public payment is still being shielded", async () => {
    // Real money in hand, just not finished — neither open nor paid.
    deposits = [deposit({ status: "pending_shield", flow: "B" })];
    const data = await (await GET(req(), params)).json();
    expect(data.status).toBe("processing");
    expect(data.payment).toBeNull();
  });

  it("expires an unpaid session", async () => {
    link = makeLink({ expiresAt: NOW - 1 });
    expect((await (await GET(req(), params)).json()).status).toBe("expired");
  });

  it("reports revoked", async () => {
    link = makeLink({ revoked: true });
    expect((await (await GET(req(), params)).json()).status).toBe("revoked");
  });

  it("stays failed-not-open when every attempt was rejected", async () => {
    deposits = [deposit({ status: "rejected" }), deposit({ status: "shield_failed" })];
    expect((await (await GET(req(), params)).json()).status).toBe("failed");
  });

  it("404s an unknown session", async () => {
    link = null;
    expect((await GET(req(), params)).status).toBe(404);
  });

  it("authorises against the stored session's merchant, not the caller's claim", async () => {
    denied = new Response(JSON.stringify({ error: "nope" }), { status: 401 });
    expect((await GET(req(), params)).status).toBe(401);
    expect(unauthorizedUnlessMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ address: MERCHANT, networkIndex: 2 })
    );
  });
});
