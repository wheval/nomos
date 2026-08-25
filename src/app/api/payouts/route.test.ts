import { NextRequest } from "next/server";
import { validateAndParseAddress } from "starknet";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyMerchantSecret = vi.fn(async () => true);
const getLedgerBalance = vi.fn(async () => 1000n);
const createPayout = vi.fn(async () => ({
  id: "payout-1",
  merchantAddress: "0xmerchant",
  destination: "0xdest",
  amountWei: 100n,
  mode: "withdraw" as const,
  status: "pending" as const,
  createdAt: 1700000000,
}));
const updatePayoutStatus = vi.fn(async () => {});
const debitLedger = vi.fn(async () => ({}) as any);
const listPayoutsFor = vi.fn(async () => []);

vi.mock("@/server/store", () => ({
  getStore: () => ({
    verifyMerchantSecret,
    getLedgerBalance,
    createPayout,
    updatePayoutStatus,
    debitLedger,
    listPayoutsFor,
  }),
}));

const executeWithdraw = vi.fn(async () => ({ txHash: "0xpayouttx" }));
const executeTransfer = vi.fn(async () => ({ txHash: "0xpayouttx2" }));
vi.mock("@/server/signer/payoutExecutor", () => ({
  getPayoutExecutor: () => ({ executeWithdraw, executeTransfer }),
}));

const { GET, POST } = await import("./route");

const VALID_ADDR_1 = "0x" + "1".repeat(63);
const VALID_ADDR_2 = "0x" + "2".repeat(63);
const NORMALIZED_ADDR_2 = validateAndParseAddress(VALID_ADDR_2);

function req(method: string, body?: unknown, query?: string, auth?: string) {
  const url = `http://localhost/api/payouts${query ?? ""}`;
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyMerchantSecret.mockResolvedValue(true);
  getLedgerBalance.mockResolvedValue(1000n);
});

describe("POST /api/payouts", () => {
  const validBody = {
    merchantAddress: VALID_ADDR_1,
    secretKey: "sk_test",
    destination: VALID_ADDR_2,
    amountWei: "100",
    token: "STRK",
    mode: "withdraw",
  };

  it("rejects an invalid secret key", async () => {
    verifyMerchantSecret.mockResolvedValue(false);
    const res = await POST(req("POST", validBody));
    expect(res.status).toBe(401);
  });

  it("rejects a payout larger than the ledger balance", async () => {
    getLedgerBalance.mockResolvedValue(50n);
    const res = await POST(req("POST", validBody));
    expect(res.status).toBe(422);
    expect(debitLedger).not.toHaveBeenCalled();
  });

  it("executes a withdraw payout, debits the ledger only on success", async () => {
    const res = await POST(req("POST", validBody));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.status).toBe("confirmed");
    expect(data.txHash).toBe("0xpayouttx");
    expect(executeWithdraw).toHaveBeenCalledWith({ amountWei: 100n, token: "STRK", destination: NORMALIZED_ADDR_2 });
    expect(debitLedger).toHaveBeenCalledWith(
      expect.objectContaining({ amountWei: 100n, kind: "payout", payoutId: "payout-1" })
    );
    expect(updatePayoutStatus).toHaveBeenCalledWith("payout-1", "confirmed", "0xpayouttx");
  });

  it("executes a transfer payout via the transfer path", async () => {
    await POST(req("POST", { ...validBody, mode: "transfer" }));
    expect(executeTransfer).toHaveBeenCalledWith({ amountWei: 100n, token: "STRK", destination: NORMALIZED_ADDR_2 });
    expect(executeWithdraw).not.toHaveBeenCalled();
  });

  it("does NOT debit the ledger when execution fails, marks the payout failed", async () => {
    executeWithdraw.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(req("POST", validBody));
    const data = await res.json();
    expect(res.status).toBe(502);
    expect(data.status).toBe("failed");
    expect(debitLedger).not.toHaveBeenCalled();
    expect(updatePayoutStatus).toHaveBeenCalledWith("payout-1", "failed");
  });

  it("rejects a malformed body", async () => {
    const res = await POST(req("POST", { merchantAddress: VALID_ADDR_1 }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/payouts", () => {
  it("requires a bearer secret", async () => {
    const res = await GET(req("GET", undefined, `?to=${VALID_ADDR_1}`));
    expect(res.status).toBe(401);
  });

  it("lists payouts for an authenticated merchant", async () => {
    listPayoutsFor.mockResolvedValue([
      {
        id: "p1",
        merchantAddress: VALID_ADDR_1,
        destination: VALID_ADDR_2,
        amountWei: 42n,
        mode: "withdraw",
        status: "confirmed",
        createdAt: 1700000000,
      },
    ] as any);
    const res = await GET(req("GET", undefined, `?to=${VALID_ADDR_1}`, "Bearer sk_test"));
    const data = await res.json();
    expect(data.payouts).toHaveLength(1);
    expect(data.payouts[0].amountWei).toBe("42");
  });
});
