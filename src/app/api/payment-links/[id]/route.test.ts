import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MERCHANT = "0x0000000000000000000000000000000000000000000000000000000000000abc";

let link: any;
let depositsForLink: any[];
const getPaymentLink = vi.fn(async () => link);
const listDepositsForLink = vi.fn(async () => depositsForLink);
const getMerchantProfile = vi.fn(async () => ({ displayName: null, allowedIps: [], logoDataUrl: null }));
const revokePaymentLink = vi.fn(async () => true);

vi.mock("@/server/store", () => ({
  getStore: () => ({ getPaymentLink, listDepositsForLink, getMerchantProfile, revokePaymentLink }),
}));

let denied: any = null;
const unauthorizedUnlessMerchant = vi.fn(async () => denied);
vi.mock("@/server/merchantAuth", () => ({ unauthorizedUnlessMerchant }));

const { GET, DELETE } = await import("./route");

const params = { params: Promise.resolve({ id: "link-1" }) };
const req = () => new NextRequest("http://localhost/api/payment-links/link-1");

function makeLink(over: Record<string, unknown> = {}) {
  return {
    id: "link-1",
    merchantAddress: MERCHANT,
    networkIndex: 2,
    amountWei: 1_000_000n,
    token: "USDC",
    note: "Course",
    ref: "LI89V6",
    revoked: false,
    createdAt: 1700000000,
    singleUse: false,
    ...over,
  };
}

describe("GET /api/payment-links/[id] — paid state", () => {
  beforeEach(() => {
    denied = null;
    link = makeLink();
    depositsForLink = [];
    listDepositsForLink.mockClear();
  });

  it("never marks a reusable page as paid, however many payments it took", async () => {
    depositsForLink = [{ status: "verified" }, { status: "verified" }];
    const body = await (await GET(req(), params)).json();
    expect(body.singleUse).toBe(false);
    expect(body.paid).toBe(false);
    // A page has no paid state, so it should not even be queried.
    expect(listDepositsForLink).not.toHaveBeenCalled();
  });

  it("marks an invoice paid once a payment is recorded", async () => {
    link = makeLink({ singleUse: true });
    depositsForLink = [{ status: "verified" }];
    const body = await (await GET(req(), params)).json();
    expect(body.paid).toBe(true);
  });

  it("counts an unshielded Flow B payment as paid — the money did arrive", async () => {
    link = makeLink({ singleUse: true });
    depositsForLink = [{ status: "pending_shield" }];
    expect((await (await GET(req(), params)).json()).paid).toBe(true);
  });

  it.each(["rejected", "shield_failed"])(
    "leaves an invoice payable after a %s attempt",
    async (status) => {
      link = makeLink({ singleUse: true });
      depositsForLink = [{ status }];
      expect((await (await GET(req(), params)).json()).paid).toBe(false);
    },
  );

  it("404s an unknown link", async () => {
    link = null;
    expect((await GET(req(), params)).status).toBe(404);
  });
});

describe("DELETE /api/payment-links/[id] — revoke", () => {
  beforeEach(() => {
    denied = null;
    link = makeLink();
    revokePaymentLink.mockClear();
    unauthorizedUnlessMerchant.mockClear();
  });

  it("revokes the link", async () => {
    const res = await DELETE(req(), params);
    expect(res.status).toBe(200);
    expect(revokePaymentLink).toHaveBeenCalledWith("link-1", MERCHANT);
  });

  it("authorises against the stored link's merchant, not a caller claim", async () => {
    await DELETE(req(), params);
    expect(unauthorizedUnlessMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ address: MERCHANT, networkIndex: 2 }),
    );
  });

  it("does not revoke when authorisation is denied", async () => {
    denied = new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401 });
    const res = await DELETE(req(), params);
    expect(res.status).toBe(401);
    expect(revokePaymentLink).not.toHaveBeenCalled();
  });

  it("404s an unknown link without touching the store", async () => {
    link = null;
    expect((await DELETE(req(), params)).status).toBe(404);
    expect(revokePaymentLink).not.toHaveBeenCalled();
  });
});
