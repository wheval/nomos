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

  it("lists pending deposits and the total", async () => {
    const res = await GET(req("GET"));
    const data = await res.json();
    expect(data.deposits).toHaveLength(1);
    expect(data.totalWei).toBe("100");
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
