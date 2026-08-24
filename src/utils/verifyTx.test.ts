import { hash, num } from "starknet";
import { describe, expect, it, vi } from "vitest";

const STRK_ADDR = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const OPERATING_WALLET = "0x00000000000000000000000000000000000000000000000000000000000abc";
const TRANSFER_SELECTOR = num.toHex(hash.getSelectorFromName("Transfer"));

let mockReceipt: any;
const getTransactionReceipt = vi.fn(async () => mockReceipt);

vi.mock("./constants", () => ({
  addrSTRK: STRK_ADDR,
  myFrontendProviders: [{ getTransactionReceipt }, undefined, { getTransactionReceipt }],
}));

const { verifyFlowADeposit, verifyFlowBDeposit } = await import("./verifyTx");

function transferEvent(opts: { from?: string; to: string; amount: bigint }) {
  return {
    from_address: opts.from ?? STRK_ADDR,
    keys: [TRANSFER_SELECTOR, "0x1", opts.to],
    data: [num.toHex(opts.amount & ((1n << 128n) - 1n)), num.toHex(opts.amount >> 128n)],
  };
}

describe("verifyFlowBDeposit", () => {
  it("accepts a Transfer event that pays the operating wallet exactly the claimed amount", async () => {
    mockReceipt = {
      execution_status: "SUCCEEDED",
      events: [transferEvent({ to: OPERATING_WALLET, amount: 100n })],
    };
    const result = await verifyFlowBDeposit({
      txHash: "0xabc",
      operatingWalletAddress: OPERATING_WALLET,
      claimedAmountWei: 100n,
      networkIndex: 2,
    });
    expect(result).toEqual({ ok: true, amountWei: 100n });
  });

  it("accepts an overpayment (actual amount >= claimed)", async () => {
    mockReceipt = {
      execution_status: "SUCCEEDED",
      events: [transferEvent({ to: OPERATING_WALLET, amount: 150n })],
    };
    const result = await verifyFlowBDeposit({
      txHash: "0xabc",
      operatingWalletAddress: OPERATING_WALLET,
      claimedAmountWei: 100n,
      networkIndex: 2,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.amountWei).toBe(150n);
  });

  it("rejects an underpayment", async () => {
    mockReceipt = {
      execution_status: "SUCCEEDED",
      events: [transferEvent({ to: OPERATING_WALLET, amount: 50n })],
    };
    const result = await verifyFlowBDeposit({
      txHash: "0xabc",
      operatingWalletAddress: OPERATING_WALLET,
      claimedAmountWei: 100n,
      networkIndex: 2,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a transfer to the wrong recipient", async () => {
    mockReceipt = {
      execution_status: "SUCCEEDED",
      events: [transferEvent({ to: "0xdead", amount: 100n })],
    };
    const result = await verifyFlowBDeposit({
      txHash: "0xabc",
      operatingWalletAddress: OPERATING_WALLET,
      claimedAmountWei: 100n,
      networkIndex: 2,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a transfer from a different token contract", async () => {
    mockReceipt = {
      execution_status: "SUCCEEDED",
      events: [transferEvent({ from: "0xnottherealtoken", to: OPERATING_WALLET, amount: 100n })],
    };
    const result = await verifyFlowBDeposit({
      txHash: "0xabc",
      operatingWalletAddress: OPERATING_WALLET,
      claimedAmountWei: 100n,
      networkIndex: 2,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a reverted transaction", async () => {
    mockReceipt = {
      execution_status: "REVERTED",
      events: [transferEvent({ to: OPERATING_WALLET, amount: 100n })],
    };
    const result = await verifyFlowBDeposit({
      txHash: "0xabc",
      operatingWalletAddress: OPERATING_WALLET,
      claimedAmountWei: 100n,
      networkIndex: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/reverted/i);
  });

  it("rejects when no Transfer event matches at all", async () => {
    mockReceipt = { execution_status: "SUCCEEDED", events: [] };
    const result = await verifyFlowBDeposit({
      txHash: "0xabc",
      operatingWalletAddress: OPERATING_WALLET,
      claimedAmountWei: 100n,
      networkIndex: 2,
    });
    expect(result.ok).toBe(false);
  });
});

describe("verifyFlowADeposit", () => {
  it("passes through the discovery client's positive result", async () => {
    const result = await verifyFlowADeposit({
      txHash: "0xabc",
      claimedAmountWei: 100n,
      discovery: { hasReceivedDeposit: async () => true },
    });
    expect(result).toEqual({ ok: true, amountWei: 100n });
  });

  it("fails when the discovery client finds no matching note", async () => {
    const result = await verifyFlowADeposit({
      txHash: "0xabc",
      claimedAmountWei: 100n,
      discovery: { hasReceivedDeposit: async () => false },
    });
    expect(result.ok).toBe(false);
  });
});
