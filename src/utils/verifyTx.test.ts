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
      tokenAddress: STRK_ADDR,
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
      tokenAddress: STRK_ADDR,
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
      tokenAddress: STRK_ADDR,
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
      tokenAddress: STRK_ADDR,
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
      tokenAddress: STRK_ADDR,
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
      tokenAddress: STRK_ADDR,
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
      tokenAddress: STRK_ADDR,
      claimedAmountWei: 100n,
      networkIndex: 2,
    });
    expect(result.ok).toBe(false);
  });

  // Mainnet USDC emits the legacy (un-indexed) Transfer: keys hold only the
  // selector and from/to live in data. Reading just the indexed shape
  // rejected these, so a real Mainnet USDC payment landed in the operating
  // wallet without ever crediting the merchant.
  describe("legacy un-indexed Transfer shape (Mainnet USDC)", () => {
    function legacyTransferEvent(opts: { to: string; amount: bigint }) {
      return {
        from_address: STRK_ADDR,
        keys: [TRANSFER_SELECTOR],
        data: [
          "0x1", // from
          opts.to,
          num.toHex(opts.amount & ((1n << 128n) - 1n)),
          num.toHex(opts.amount >> 128n),
        ],
      };
    }

    it("accepts a legacy Transfer paying the operating wallet", async () => {
      mockReceipt = {
        execution_status: "SUCCEEDED",
        events: [legacyTransferEvent({ to: OPERATING_WALLET, amount: 100n })],
      };
      const result = await verifyFlowBDeposit({
        txHash: "0xabc",
        operatingWalletAddress: OPERATING_WALLET,
        tokenAddress: STRK_ADDR,
        claimedAmountWei: 100n,
        networkIndex: 0,
      });
      expect(result).toEqual({ ok: true, amountWei: 100n });
    });

    it("rejects a legacy Transfer paying someone else", async () => {
      mockReceipt = {
        execution_status: "SUCCEEDED",
        events: [legacyTransferEvent({ to: "0xdead", amount: 100n })],
      };
      const result = await verifyFlowBDeposit({
        txHash: "0xabc",
        operatingWalletAddress: OPERATING_WALLET,
        tokenAddress: STRK_ADDR,
        claimedAmountWei: 100n,
        networkIndex: 0,
      });
      expect(result.ok).toBe(false);
    });

    it("rejects a legacy underpayment", async () => {
      mockReceipt = {
        execution_status: "SUCCEEDED",
        events: [legacyTransferEvent({ to: OPERATING_WALLET, amount: 99n })],
      };
      const result = await verifyFlowBDeposit({
        txHash: "0xabc",
        operatingWalletAddress: OPERATING_WALLET,
        tokenAddress: STRK_ADDR,
        claimedAmountWei: 100n,
        networkIndex: 0,
      });
      expect(result.ok).toBe(false);
    });

    // Verbatim from a live Mainnet USDC Transfer (getEvents, Aug 2026):
    // keys.length 1, data.length 4, amount 0x372cc9 = 3.615945 USDC.
    it("decodes a real Mainnet USDC event", async () => {
      const realTo = "0x6128d8e1f4e35ff05e8264b6355dba03ceff0f665a3ac790cab04b83491aef5";
      mockReceipt = {
        execution_status: "SUCCEEDED",
        events: [
          {
            from_address: STRK_ADDR,
            keys: [TRANSFER_SELECTOR],
            data: [
              "0x1bd045134372c04c2a0478c84e637eb881bdddcf4f2b45c1a99ca654792593d",
              realTo,
              "0x372cc9",
              "0x0",
            ],
          },
        ],
      };
      const result = await verifyFlowBDeposit({
        txHash: "0xabc",
        operatingWalletAddress: realTo,
        tokenAddress: STRK_ADDR,
        claimedAmountWei: 3_615_945n,
        networkIndex: 0,
      });
      expect(result).toEqual({ ok: true, amountWei: 3_615_945n });
    });
  });
});

describe("verifyFlowADeposit", () => {
  it("passes through the discovery client's positive result", async () => {
    const result = await verifyFlowADeposit({
      txHash: "0xabc",
      claimedAmountWei: 100n,
      tokenAddress: STRK_ADDR,
      discovery: { hasReceivedDeposit: async () => true },
    });
    expect(result).toEqual({ ok: true, amountWei: 100n });
  });

  it("fails when the discovery client finds no matching note", async () => {
    const result = await verifyFlowADeposit({
      txHash: "0xabc",
      claimedAmountWei: 100n,
      tokenAddress: STRK_ADDR,
      discovery: { hasReceivedDeposit: async () => false },
    });
    expect(result.ok).toBe(false);
  });
});
