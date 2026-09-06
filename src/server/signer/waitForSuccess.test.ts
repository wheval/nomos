import { describe, expect, it, vi } from "vitest";
import { waitForSuccess } from "./privacyClient";

// waitForTransaction waits for inclusion, not for success — it resolves for a
// REVERTED transaction exactly as it does for a successful one. A reverted
// payout that looked successful would debit the merchant's ledger and be
// recorded confirmed, so they lose the balance and receive nothing.
function provider(receipt: unknown) {
  return { waitForTransaction: vi.fn(async () => receipt) } as any;
}

describe("waitForSuccess", () => {
  it("passes a succeeded transaction through", async () => {
    await expect(waitForSuccess(provider({ execution_status: "SUCCEEDED" }), "0xabc", "Payout")).resolves
      .toBeUndefined();
  });

  it("throws on a reverted one, naming the action and the hash", async () => {
    await expect(
      waitForSuccess(
        provider({ execution_status: "REVERTED", revert_reason: "Insufficient ERC20 allowance" }),
        "0xdead",
        "Pool fee approval"
      )
    ).rejects.toThrow(/Pool fee approval reverted on-chain \(0xdead\): Insufficient ERC20 allowance/);
  });

  it("reads the status through the wrapped shape starknet.js sometimes returns", async () => {
    await expect(
      waitForSuccess(provider({ value: { execution_status: "REVERTED" } }), "0xdead", "Payout")
    ).rejects.toThrow(/reverted on-chain/);
  });

  it("still throws when the receipt gives no reason", async () => {
    await expect(
      waitForSuccess(provider({ execution_status: "REVERTED" }), "0xdead", "Payout")
    ).rejects.toThrow(/no reason given/);
  });

  it("does not invent a failure when the node omits the status", async () => {
    // Only REVERTED is a revert. Treating an absent field as failure would
    // fail payouts that actually landed.
    await expect(waitForSuccess(provider({}), "0xabc", "Payout")).resolves.toBeUndefined();
  });
});
