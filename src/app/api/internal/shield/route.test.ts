import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-secret";
process.env.NOMOS_SHIELD_WORKER_SECRET = SECRET;

const mockDeposit = {
  id: "dep-1",
  merchantAddress: "0xmerchant",
  flow: "B" as const,
  txHash: "0xtx1",
  amountWei: 100n,
  token: "STRK",
  networkIndex: 2,
  status: "pending_shield" as const,
  recordedAt: 1700000000,
};

const listPendingShieldDeposits = vi.fn(async () => [mockDeposit]);
const markDepositShielded = vi.fn(async () => {});
const creditLedger = vi.fn(async () => ({}) as any);
const deliverPaymentWebhook = vi.fn(async () => {});

vi.mock("@/server/store", () => ({
  getStore: () => ({ listPendingShieldDeposits, markDepositShielded, creditLedger }),
}));
vi.mock("@/utils/webhook", () => ({ deliverPaymentWebhook }));

const { GET, POST } = await import("./route");

function req(method: string, body?: unknown, auth = `Bearer ${SECRET}`) {
  return new NextRequest("http://localhost/api/internal/shield", {
    method,
    headers: { authorization: auth, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listPendingShieldDeposits.mockResolvedValue([mockDeposit]);
});

describe("GET /api/internal/shield", () => {
  it("rejects without the correct bearer secret", async () => {
    const res = await GET(req("GET", undefined, "Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("lists pending deposits and what the batch adds up to", async () => {
    const res = await GET(req("GET"));
    const data = await res.json();
    expect(data.deposits).toHaveLength(1);
    expect(data.groups).toEqual([
      { networkIndex: 2, token: "STRK", totalWei: "100", depositIds: ["dep-1"] },
    ]);
  });

  it("never adds two tokens together, or two networks", async () => {
    // One shield action covers one token on one network. A single total
    // across everything summed 1 USDC (1e6) with 1 STRK (1e18) and handed an
    // operator a number that meant nothing.
    listPendingShieldDeposits.mockResolvedValue([
      mockDeposit,
      { ...mockDeposit, id: "dep-2", token: "USDC", amountWei: 5n },
      { ...mockDeposit, id: "dep-3", networkIndex: 0, amountWei: 7n },
      { ...mockDeposit, id: "dep-4", amountWei: 3n },
    ]);
    const res = await GET(req("GET"));
    const { groups } = await res.json();
    expect(groups).toHaveLength(3);
    const strkSepolia = groups.find((g: any) => g.token === "STRK" && g.networkIndex === 2);
    expect(strkSepolia.totalWei).toBe("103");
    expect(strkSepolia.depositIds).toEqual(["dep-1", "dep-4"]);
    expect(groups.find((g: any) => g.token === "USDC").totalWei).toBe("5");
    expect(groups.find((g: any) => g.networkIndex === 0).totalWei).toBe("7");
  });
});

describe("POST /api/internal/shield", () => {
  it("rejects without the correct bearer secret", async () => {
    const res = await POST(req("POST", { depositIds: ["dep-1"], shieldTxHash: "0xshield" }, "Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("marks deposits shielded, credits the ledger, and fires the webhook", async () => {
    const res = await POST(req("POST", { depositIds: ["dep-1"], shieldTxHash: "0xshield" }));
    const data = await res.json();
    expect(data.results).toEqual([{ depositId: "dep-1", ok: true }]);
    expect(markDepositShielded).toHaveBeenCalledWith("dep-1", "0xshield");
    expect(creditLedger).toHaveBeenCalledWith(
      expect.objectContaining({ merchantAddress: "0xmerchant", amountWei: 100n, kind: "flow_b_deposit" })
    );
    expect(deliverPaymentWebhook).toHaveBeenCalledTimes(1);
  });

  it("reports a per-deposit failure without failing the whole batch", async () => {
    const res = await POST(req("POST", { depositIds: ["dep-1", "dep-missing"], shieldTxHash: "0xshield" }));
    const data = await res.json();
    expect(data.results).toEqual([
      { depositId: "dep-1", ok: true },
      { depositId: "dep-missing", ok: false, error: "Not found or not pending_shield." },
    ]);
  });

  it("rejects a malformed body", async () => {
    const res = await POST(req("POST", { depositIds: [] }));
    expect(res.status).toBe(400);
  });
});
