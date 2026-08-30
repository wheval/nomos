import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MERCHANT = "0x0000000000000000000000000000000000000000000000000000000000000abc";

let deposit: any;
const getDepositByReference = vi.fn(async () => deposit);

vi.mock("@/server/store", () => ({
  getStore: () => ({ getDepositByReference }),
}));

let denied: any = null;
const unauthorizedUnlessMerchant = vi.fn(async () => denied);
vi.mock("@/server/merchantAuth", () => ({ unauthorizedUnlessMerchant }));

const { GET } = await import("./route");

function call(reference: string) {
  return GET(new NextRequest(`http://localhost/api/transactions/${reference}`), {
    params: Promise.resolve({ reference }),
  });
}

function makeDeposit(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    merchantAddress: MERCHANT,
    networkIndex: 2,
    flow: "A",
    txHash: "0xtx",
    amountWei: 1_000_000n,
    token: "USDC",
    reference: "nx_abc",
    linkId: "link-1",
    ref: "LI89V6",
    note: "Course",
    status: "verified",
    recordedAt: 1700000000,
    ...over,
  };
}

describe("GET /api/transactions/[reference]", () => {
  beforeEach(() => {
    denied = null;
    deposit = makeDeposit();
    getDepositByReference.mockClear();
    unauthorizedUnlessMerchant.mockClear();
  });

  it("reports a verified deposit as success, with the amount to check against", async () => {
    const res = await call("nx_abc");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.amountWei).toBe("1000000");
    expect(body.decimals).toBe(6);
    expect(body.reference).toBe("nx_abc");
  });

  it("treats a shielded deposit as success too", async () => {
    deposit = makeDeposit({ status: "shielded" });
    const body = await (await call("nx_abc")).json();
    expect(body.status).toBe("success");
  });

  it("reports an unshielded Flow B deposit as pending, not success", async () => {
    // Received on-chain but not yet credited — a merchant must not deliver
    // value on this.
    deposit = makeDeposit({ flow: "B", status: "pending_shield" });
    const body = await (await call("nx_abc")).json();
    expect(body.status).toBe("pending");
    expect(body.depositStatus).toBe("pending_shield");
  });

  it.each(["rejected", "shield_failed"])("reports %s as failed", async (status) => {
    deposit = makeDeposit({ status });
    const body = await (await call("nx_abc")).json();
    expect(body.status).toBe("failed");
  });

  it("404s an unknown reference", async () => {
    deposit = null;
    const res = await call("nx_nope");
    expect(res.status).toBe(404);
  });

  it("authorises against the deposit's own merchant, not a caller claim", async () => {
    await call("nx_abc");
    expect(unauthorizedUnlessMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ address: MERCHANT, networkIndex: 2 }),
    );
  });

  it("does not leak the transaction when authorisation is denied", async () => {
    denied = new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401 });
    const res = await call("nx_abc");
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("0xtx");
  });
});
