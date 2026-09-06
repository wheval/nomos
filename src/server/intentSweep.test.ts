import { beforeEach, describe, expect, it, vi } from "vitest";

const settleIntentFromChain = vi.fn();
const listOpenPaymentIntents = vi.fn();

vi.mock("@/server/attribution", () => ({ settleIntentFromChain }));
vi.mock("@/server/store", () => ({ getStore: () => ({ listOpenPaymentIntents }) }));

const { sweepOpenIntents } = await import("./intentSweep");

const now = () => Math.floor(Date.now() / 1000);

function intent(over: Partial<{ id: string; createdAt: number; merchantAddress: string }> = {}) {
  return {
    id: over.id ?? "i1",
    merchantAddress: over.merchantAddress ?? "0xmerchant",
    networkIndex: 2 as const,
    flow: "A" as const,
    amountWei: 1n,
    token: "STRK",
    status: "open" as const,
    createdAt: over.createdAt ?? now() - 600,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  settleIntentFromChain.mockResolvedValue({ settled: true, reference: "nx_1", alreadySettled: false });
});

describe("sweepOpenIntents", () => {
  it("settles an intent whose payer never came back", async () => {
    listOpenPaymentIntents.mockResolvedValue([intent()]);
    expect(await sweepOpenIntents({ networkIndex: 2 })).toEqual({ swept: 1, settled: 1, errors: 0 });
    expect(settleIntentFromChain).toHaveBeenCalledWith("i1");
  });

  it("leaves a fresh intent to the checkout that is still polling it", async () => {
    listOpenPaymentIntents.mockResolvedValue([intent({ createdAt: now() - 5 })]);
    expect(await sweepOpenIntents({ networkIndex: 2 })).toEqual({ swept: 0, settled: 0, errors: 0 });
    expect(settleIntentFromChain).not.toHaveBeenCalled();
  });

  it("sweeps only the merchant who asked, when one asked", async () => {
    listOpenPaymentIntents.mockResolvedValue([
      intent({ id: "mine", merchantAddress: "0xa" }),
      intent({ id: "theirs", merchantAddress: "0xb" }),
    ]);
    const out = await sweepOpenIntents({ networkIndex: 2, merchantAddress: "0xa" });
    expect(out.swept).toBe(1);
    expect(settleIntentFromChain).toHaveBeenCalledExactlyOnceWith("mine");
  });

  it("does not count an already-settled intent as newly settled", async () => {
    listOpenPaymentIntents.mockResolvedValue([intent()]);
    settleIntentFromChain.mockResolvedValue({ settled: true, reference: "nx_1", alreadySettled: true });
    expect(await sweepOpenIntents({ networkIndex: 2 })).toMatchObject({ swept: 1, settled: 0 });
  });

  it("takes the oldest first, and stops at the limit", async () => {
    listOpenPaymentIntents.mockResolvedValue([
      intent({ id: "newer", createdAt: now() - 100 }),
      intent({ id: "oldest", createdAt: now() - 9000 }),
      intent({ id: "middle", createdAt: now() - 500 }),
    ]);
    await sweepOpenIntents({ networkIndex: 2, limit: 2 });
    expect(settleIntentFromChain.mock.calls.map((c) => c[0])).toEqual(["oldest", "middle"]);
  });

  it("survives one intent throwing, and keeps going", async () => {
    listOpenPaymentIntents.mockResolvedValue([
      intent({ id: "bad", createdAt: now() - 9000 }),
      intent({ id: "good", createdAt: now() - 100 }),
    ]);
    settleIntentFromChain.mockRejectedValueOnce(new Error("rpc down"));
    const out = await sweepOpenIntents({ networkIndex: 2 });
    expect(out).toEqual({ swept: 2, settled: 1, errors: 1 });
  });

  it("never throws at its caller when the store is down", async () => {
    // This runs inside the merchant's own console read. A failing sweep must
    // not be the reason they cannot see their balance.
    listOpenPaymentIntents.mockRejectedValue(new Error("supabase unreachable"));
    expect(await sweepOpenIntents({ networkIndex: 2 })).toEqual({ swept: 0, settled: 0, errors: 1 });
  });
});
