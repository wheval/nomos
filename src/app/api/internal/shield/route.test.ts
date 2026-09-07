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
  // clearAllMocks resets calls but keeps implementations, so a test that made
  // one of these reject would otherwise poison every test after it.
  markDepositShielded.mockResolvedValue(undefined);
  creditLedger.mockResolvedValue({} as never);
  deliverPaymentWebhook.mockResolvedValue(undefined);
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

describe("partial failure while marking a batch shielded", () => {
  // Marking first meant a failed credit dropped the deposit out of
  // pending_shield and so out of the operator's queue, with the merchant
  // never paid and nothing left to show it had happened.
  const body = { depositIds: ["dep-1"], shieldTxHash: "0xshield" };

  it("credits before it marks, so a failed credit leaves a clean retry", async () => {
    const order: string[] = [];
    creditLedger.mockImplementation(async () => {
      order.push("credit");
      return {} as never;
    });
    markDepositShielded.mockImplementation(async () => {
      order.push("mark");
    });
    await POST(req("POST", body));
    expect(order).toEqual(["credit", "mark"]);
  });

  it("does not mark a deposit whose credit failed", async () => {
    creditLedger.mockRejectedValue(new Error("ledger unavailable"));
    const { results } = await (await POST(req("POST", body))).json();
    expect(results[0].ok).toBe(false);
    expect(markDepositShielded).not.toHaveBeenCalled();
  });

  it("warns rather than inviting a retry when only the status update failed", async () => {
    // Re-marking would credit the merchant twice.
    markDepositShielded.mockRejectedValue(new Error("write failed"));
    const { results } = await (await POST(req("POST", body))).json();
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/do not re-mark/i);
    expect(creditLedger).toHaveBeenCalledTimes(1);
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
