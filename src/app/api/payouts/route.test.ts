import { NextRequest } from "next/server";
import { validateAndParseAddress } from "starknet";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { minimumPayoutWei, payoutFeeWei } from "@/utils/fees";

// Derived from the live fee schedule rather than copied from it: these
// numbers moved once already when pricing was cut for the prototype, and the
// hardcoded copy silently went stale.
const REQUESTED = minimumPayoutWei("STRK") * 3n;
const PAYOUT_FEE = payoutFeeWei("STRK");
const SENT = REQUESTED - PAYOUT_FEE;

const verifyMerchantSecret = vi.fn(async () => true);
const getLedgerBalance = vi.fn(async () => REQUESTED * 2n);
const createPayout = vi.fn(async () => ({
  id: "payout-1",
  merchantAddress: "0xmerchant",
  destination: "0xdest",
  amountWei: SENT,
  mode: "withdraw" as const,
  status: "pending" as const,
  createdAt: 1700000000,
}));
// Typed with its real signature so a test can assert call ordering.
const updatePayoutStatus = vi.fn(async (_id: string, _status: string, _txHash?: string) => {});
const debitLedger = vi.fn(async () => ({}) as any);
const listPayoutsFor = vi.fn(async (): Promise<any[]> => []);
const getMerchantProfile = vi.fn(async () => ({ displayName: null, allowedIps: [] as string[], logoDataUrl: null }));

vi.mock("@/server/store", () => ({
  getStore: () => ({
    verifyMerchantSecret,
    getLedgerBalance,
    createPayout,
    updatePayoutStatus,
    debitLedger,
    listPayoutsFor,
    getMerchantProfile,
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
  getLedgerBalance.mockResolvedValue(REQUESTED * 2n);
  listPayoutsFor.mockResolvedValue([]);
  // clearAllMocks resets calls but keeps implementations, so a test that made
  // one of these reject would otherwise poison every test after it.
  executeWithdraw.mockResolvedValue({ txHash: "0xpayouttx" });
  executeTransfer.mockResolvedValue({ txHash: "0xpayouttx2" });
  debitLedger.mockResolvedValue({} as never);
  updatePayoutStatus.mockResolvedValue(undefined);
});

describe("once the money has moved", () => {
  // The ordering here is the whole safety property. debitLedger used to run
  // before the payout was marked confirmed, and when a database constraint
  // rejected the fee entry, the catch marked a payout that had already
  // settled on-chain as "failed" and threw its transaction hash away.
  const body = {
    merchantAddress: VALID_ADDR_1,
    secretKey: "sk_test",
    destination: VALID_ADDR_2,
    amountWei: REQUESTED.toString(),
    token: "STRK",
    mode: "withdraw",
    networkIndex: 2,
  };

  it("records the transaction hash before touching the ledger", async () => {
    const order: string[] = [];
    updatePayoutStatus.mockImplementation(async (_id, status) => {
      order.push(`status:${status}`);
    });
    debitLedger.mockImplementation(async () => {
      order.push("debit");
      return {} as never;
    });
    await POST(req("POST", body));
    expect(order.indexOf("status:confirmed")).toBeLessThan(order.indexOf("debit"));
  });

  it("keeps a settled payout confirmed even when its ledger debit fails", async () => {
    // Anything else invites a retry that spends the funds a second time.
    debitLedger.mockRejectedValue(new Error('violates check constraint "ledger_entries_kind_check"'));
    const res = await POST(req("POST", body));
    expect(res.status).toBe(201);
    expect((await res.json()).status).toBe("confirmed");
    expect(updatePayoutStatus).not.toHaveBeenCalledWith(expect.anything(), "failed");
  });

  it("still returns the hash when the ledger fails, so the payout is traceable", async () => {
    debitLedger.mockRejectedValue(new Error("database is down"));
    expect((await (await POST(req("POST", body))).json()).txHash).toBe("0xpayouttx");
  });

  it("marks failed only when the chain itself failed", async () => {
    executeWithdraw.mockRejectedValue(new Error("reverted"));
    const res = await POST(req("POST", body));
    expect(res.status).toBe(502);
    expect(updatePayoutStatus).toHaveBeenCalledWith(expect.anything(), "failed");
    expect(debitLedger).not.toHaveBeenCalled();
  });
});

describe("one payout in flight at a time", () => {
  // The ledger is debited only once a payout settles on-chain, so until then
  // the balance still reads as available. Without this guard a double-clicked
  // withdraw, a retry, or two open tabs all pass the balance check and all
  // execute — paying the merchant twice against one balance.
  const body = {
    merchantAddress: VALID_ADDR_1,
    secretKey: "sk_test",
    destination: VALID_ADDR_2,
    amountWei: REQUESTED.toString(),
    token: "STRK",
    mode: "withdraw",
    networkIndex: 2,
  };

  for (const status of ["pending", "broadcasting"] as const) {
    it(`refuses a second payout while one is ${status}`, async () => {
      listPayoutsFor.mockResolvedValue([{ id: "in-flight", token: "STRK", status, networkIndex: 2 } as any]);
      const res = await POST(req("POST", body));
      expect(res.status).toBe(409);
      expect((await res.json()).payoutId).toBe("in-flight");
      expect(createPayout).not.toHaveBeenCalled();
    });
  }

  for (const status of ["confirmed", "failed"] as const) {
    it(`allows the next payout once the last one is ${status}`, async () => {
      listPayoutsFor.mockResolvedValue([{ id: "done", token: "STRK", status, networkIndex: 2 } as any]);
      expect((await POST(req("POST", body))).status).toBe(201);
    });
  }

  it("does not let a pending STRK payout block a USDC one", async () => {
    listPayoutsFor.mockResolvedValue([{ id: "strk", token: "STRK", status: "pending", networkIndex: 2 } as any]);
    const res = await POST(req("POST", { ...body, token: "USDC", amountWei: (minimumPayoutWei("USDC") * 3n).toString() }));
    expect(res.status).toBe(201);
  });
});

describe("POST /api/payouts", () => {
  const validBody = {
    merchantAddress: VALID_ADDR_1,
    secretKey: "sk_test",
    networkIndex: 2,
    destination: VALID_ADDR_2,
    amountWei: REQUESTED.toString(),
    token: "STRK",
    mode: "withdraw",
  };

  it("rejects an invalid secret key", async () => {
    verifyMerchantSecret.mockResolvedValue(false);
    const res = await POST(req("POST", validBody));
    expect(res.status).toBe(401);
  });

  it("rejects a payout larger than the ledger balance", async () => {
    getLedgerBalance.mockResolvedValue(REQUESTED / 2n);
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
    // What reaches the chain is the requested amount less the payout fee.
    expect(executeWithdraw).toHaveBeenCalledWith({ amountWei: SENT, token: "STRK", destination: NORMALIZED_ADDR_2 });
    expect(data.sentWei).toBe(SENT.toString());
    expect(data.feeWei).toBe(PAYOUT_FEE.toString());
    expect(debitLedger).toHaveBeenCalledWith(
      expect.objectContaining({ amountWei: SENT, kind: "payout", payoutId: "payout-1" })
    );
    // The fee is a separate ledger line, not folded into the payout.
    expect(debitLedger).toHaveBeenCalledWith(
      expect.objectContaining({ amountWei: PAYOUT_FEE, kind: "payout_fee", payoutId: "payout-1" })
    );
    expect(updatePayoutStatus).toHaveBeenCalledWith("payout-1", "confirmed", "0xpayouttx");
  });

  it("executes a transfer payout via the transfer path", async () => {
    await POST(req("POST", { ...validBody, mode: "transfer" }));
    expect(executeTransfer).toHaveBeenCalledWith({ amountWei: SENT, token: "STRK", destination: NORMALIZED_ADDR_2 });
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
    const res = await GET(req("GET", undefined, `?to=${VALID_ADDR_1}&network=2`));
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
    const res = await GET(req("GET", undefined, `?to=${VALID_ADDR_1}&network=2`, "Bearer sk_test"));
    const data = await res.json();
    expect(data.payouts).toHaveLength(1);
    expect(data.payouts[0].amountWei).toBe("42");
  });
});
