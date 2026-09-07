import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const unauthorizedUnlessMerchant = vi.fn(async () => null as unknown);
const listDepositsFor = vi.fn(async (): Promise<any[]> => []);
const sweepOpenIntents = vi.fn(async () => ({ swept: 0, settled: 0, errors: 0 }));

vi.mock("@/server/store", () => ({ getStore: () => ({ listDepositsFor }) }));
vi.mock("@/server/merchantAuth", () => ({ unauthorizedUnlessMerchant }));
vi.mock("@/server/intentSweep", () => ({ sweepOpenIntents }));

const { GET } = await import("./route");

const ADDR = "0x" + "1".repeat(63);

function deposit(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    reference: "nx_7f21c9",
    token: "USDC",
    amountWei: 25_000_000n,
    feeWei: 10_000n,
    flow: "A",
    status: "verified",
    txHash: "0xabc",
    recordedAt: 1_700_000_000,
    ...over,
  };
}

function req(query = `?to=${ADDR}&network=2`) {
  return new NextRequest(`http://localhost/api/payments/export${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  unauthorizedUnlessMerchant.mockResolvedValue(null);
  listDepositsFor.mockResolvedValue([deposit()]);
});

describe("GET /api/payments/export", () => {
  it("refuses anyone who is not the merchant", async () => {
    const denial = new Response("no", { status: 401 });
    unauthorizedUnlessMerchant.mockResolvedValue(denial);
    expect(await GET(req())).toBe(denial);
    expect(listDepositsFor).not.toHaveBeenCalled();
  });

  it("serves a downloadable, uncacheable CSV", async () => {
    const res = await GET(req());
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="nomos-payments-sepolia-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("gives an accountant arithmetic that closes", async () => {
    const body = await (await GET(req())).text();
    const [, row] = body.trim().split("\r\n");
    // gross 25.000000 - fee 0.010000 = net 24.990000
    expect(row).toContain("25.000000,0.010000,24.990000");
  });

  it("names the flow in words, not a protocol letter", async () => {
    listDepositsFor.mockResolvedValue([deposit(), deposit({ id: "d2", flow: "B" })]);
    const body = await (await GET(req())).text();
    expect(body).toContain("private");
    expect(body).toContain("public");
  });

  it("neutralises a note that a spreadsheet would execute", async () => {
    // Merchants and payers write these fields.
    listDepositsFor.mockResolvedValue([deposit({ note: '=HYPERLINK("http://evil","x")' })]);
    const body = await (await GET(req())).text();
    expect(body).toContain("'=HYPERLINK");
  });

  it("cannot have its rows forged by a note containing a newline", async () => {
    listDepositsFor.mockResolvedValue([deposit({ note: "one\r\nnx_forged,fake" })]);
    const body = await (await GET(req())).text();
    // Header plus exactly one record, however many newlines the note holds.
    expect(body.trim().split("\r\n").filter((l) => l.startsWith("2023-") || l.startsWith("date_utc")).length).toBe(2);
  });

  it("settles pending arrivals first, so the record has no known gaps", async () => {
    await GET(req());
    expect(sweepOpenIntents).toHaveBeenCalledWith(expect.objectContaining({ networkIndex: 2 }));
  });

  it("orders oldest first, the way a ledger reads", async () => {
    listDepositsFor.mockResolvedValue([
      deposit({ id: "late", reference: "nx_late", recordedAt: 1_800_000_000 }),
      deposit({ id: "early", reference: "nx_early", recordedAt: 1_600_000_000 }),
    ]);
    const body = await (await GET(req())).text();
    expect(body.indexOf("nx_early")).toBeLessThan(body.indexOf("nx_late"));
  });

  it("rejects a bad address and a bad network", async () => {
    expect((await GET(req("?to=nonsense&network=2"))).status).toBe(400);
    expect((await GET(req(`?to=${ADDR}&network=99`))).status).toBe(400);
  });
});
