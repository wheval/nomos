import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPaymentLink = vi.fn();
const listOpenPaymentIntents = vi.fn(async (): Promise<any[]> => []);
const listDepositsForLink = vi.fn(async (): Promise<any[]> => []);
const createPaymentIntent = vi.fn(async (input: any) => ({ id: "intent-1", ...input, status: "open" }));

vi.mock("@/server/store", () => ({
  getStore: () => ({ getPaymentLink, listOpenPaymentIntents, listDepositsForLink, createPaymentIntent }),
}));

const { POST } = await import("./route");

const LINK = {
  id: "link-1",
  merchantAddress: "0xmerchant",
  networkIndex: 2,
  token: "USDC",
  amountWei: 1_000_000n,
  revoked: false,
  singleUse: false,
};

function req(body: unknown) {
  return new NextRequest("http://localhost/api/payments/intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = { linkId: "link-1", flow: "A", amountWei: "1000000" };

beforeEach(() => {
  vi.clearAllMocks();
  getPaymentLink.mockResolvedValue({ ...LINK });
  listOpenPaymentIntents.mockResolvedValue([]);
  listDepositsForLink.mockResolvedValue([]);
});

describe("POST /api/payments/intent", () => {
  it("reserves an amount at or just above the link's price", async () => {
    const res = await POST(req(validBody));
    expect(res.status).toBe(201);
    const { amountWei } = await res.json();
    expect(BigInt(amountWei)).toBeGreaterThanOrEqual(1_000_000n);
    expect(BigInt(amountWei)).toBeLessThan(1_001_000n);
  });

  it("takes the merchant and token from the link, never from the caller", async () => {
    await POST(req({ ...validBody, merchantAddress: "0xattacker", token: "STRK", networkIndex: 0 }));
    expect(createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ merchantAddress: "0xmerchant", token: "USDC", networkIndex: 2 })
    );
  });

  describe("a settled invoice", () => {
    // Refusing here is the only refusal that costs the payer nothing: an
    // intent is reserved before the wallet is invoked. /api/payments runs
    // after the money has already moved, so it records a duplicate instead.
    it("is refused before the payer spends any gas", async () => {
      getPaymentLink.mockResolvedValue({ ...LINK, singleUse: true });
      listDepositsForLink.mockResolvedValue([{ status: "verified" }]);
      const res = await POST(req(validBody));
      expect(res.status).toBe(409);
      expect((await res.json()).alreadyPaid).toBe(true);
      expect(createPaymentIntent).not.toHaveBeenCalled();
    });

    it("is still payable when the only prior attempt failed", async () => {
      getPaymentLink.mockResolvedValue({ ...LINK, singleUse: true });
      listDepositsForLink.mockResolvedValue([{ status: "rejected" }, { status: "shield_failed" }]);
      expect((await POST(req(validBody))).status).toBe(201);
    });

    it("does not restrict a link that is not single-use", async () => {
      listDepositsForLink.mockResolvedValue([{ status: "verified" }]);
      expect((await POST(req(validBody))).status).toBe(201);
    });
  });

  it("refuses a revoked link", async () => {
    getPaymentLink.mockResolvedValue({ ...LINK, revoked: true });
    expect((await POST(req(validBody))).status).toBe(410);
  });

  it("refuses an expired link", async () => {
    getPaymentLink.mockResolvedValue({ ...LINK, expiresAt: Date.now() / 1000 - 60 });
    expect((await POST(req(validBody))).status).toBe(410);
  });

  it("refuses a link that does not exist", async () => {
    getPaymentLink.mockResolvedValue(null);
    expect((await POST(req(validBody))).status).toBe(404);
  });

  it("never reserves an amount another open attempt already holds", async () => {
    listOpenPaymentIntents.mockResolvedValue([
      { token: "USDC", amountWei: 1_000_000n },
      { token: "USDC", amountWei: 1_000_001n },
    ]);
    const { amountWei } = await (await POST(req(validBody))).json();
    expect([1_000_000n, 1_000_001n]).not.toContain(BigInt(amountWei));
  });
});
