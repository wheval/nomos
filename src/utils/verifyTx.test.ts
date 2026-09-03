import { hash, num } from "starknet";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  // The regression this whole rewrite exists for: matching on amount alone let
  // a fabricated txHash be credited against somebody else's note.
  const NOTE_BLOCK = 900;

  function notes(list: Array<{ id: string; amount: bigint; createdBlock?: number }>) {
    return { listNotes: async () => list };
  }

  function claims() {
    const seen = new Set<string>();
    const claimNote = vi.fn(async (id: string) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return { claimNote, seen };
  }

  beforeEach(() => {
    mockReceipt = { execution_status: "SUCCEEDED", block_number: NOTE_BLOCK, events: [] };
  });

  const base = {
    txHash: "0xabc",
    claimedAmountWei: 100n,
    tokenAddress: STRK_ADDR,
    networkIndex: 2,
  };

  it("credits a real transaction whose block holds a matching unspent note", async () => {
    const { claimNote } = claims();
    const result = await verifyFlowADeposit({
      ...base,
      discovery: notes([{ id: "note-1", amount: 100n, createdBlock: NOTE_BLOCK }]),
      claimNote,
    });
    expect(result).toEqual({ ok: true, amountWei: 100n });
    expect(claimNote).toHaveBeenCalledWith("note-1");
  });

  it("rejects a fabricated transaction hash outright", async () => {
    // No such transaction: the receipt lookup throws before any note is read.
    getTransactionReceipt.mockRejectedValueOnce(new Error("Transaction hash not found"));
    const listNotes = vi.fn(async () => [{ id: "note-1", amount: 100n, createdBlock: NOTE_BLOCK }]);
    const { claimNote } = claims();

    const result = await verifyFlowADeposit({ ...base, discovery: { listNotes }, claimNote });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no such transaction/i);
    expect(listNotes).not.toHaveBeenCalled();
    expect(claimNote).not.toHaveBeenCalled();
  });

  it("rejects a reverted transaction", async () => {
    mockReceipt = { execution_status: "REVERTED", block_number: NOTE_BLOCK };
    const { claimNote } = claims();
    const result = await verifyFlowADeposit({
      ...base,
      discovery: notes([{ id: "note-1", amount: 100n, createdBlock: NOTE_BLOCK }]),
      claimNote,
    });
    expect(result.ok).toBe(false);
    expect(claimNote).not.toHaveBeenCalled();
  });

  it("never credits the same note twice", async () => {
    const { claimNote } = claims();
    const discovery = notes([{ id: "note-1", amount: 100n, createdBlock: NOTE_BLOCK }]);

    const first = await verifyFlowADeposit({ ...base, discovery, claimNote });
    const second = await verifyFlowADeposit({ ...base, txHash: "0xdef", discovery, claimNote });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toMatch(/already been credited/i);
  });

  it("moves on to another note of the same amount rather than failing", async () => {
    const { claimNote } = claims();
    const discovery = notes([
      { id: "note-1", amount: 100n, createdBlock: NOTE_BLOCK },
      { id: "note-2", amount: 100n, createdBlock: NOTE_BLOCK },
    ]);
    expect((await verifyFlowADeposit({ ...base, discovery, claimNote })).ok).toBe(true);
    // A second genuine payment of the same size settles against the other note.
    expect((await verifyFlowADeposit({ ...base, txHash: "0xdef", discovery, claimNote })).ok).toBe(true);
  });

  it("rejects a note created in a different block from the transaction", async () => {
    const { claimNote } = claims();
    const result = await verifyFlowADeposit({
      ...base,
      discovery: notes([{ id: "note-old", amount: 100n, createdBlock: NOTE_BLOCK - 50 }]),
      claimNote,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/block/i);
    expect(claimNote).not.toHaveBeenCalled();
  });

  it("falls back to the amount match when discovery reports no creation blocks", async () => {
    // Not every discovery provider populates `created`; rejecting everything
    // in that case would break real payments. The claim still bounds it.
    const { claimNote } = claims();
    const result = await verifyFlowADeposit({
      ...base,
      discovery: notes([{ id: "note-1", amount: 100n }]),
      claimNote,
    });
    expect(result.ok).toBe(true);
  });

  it("fails when no note matches the amount", async () => {
    const { claimNote } = claims();
    const result = await verifyFlowADeposit({
      ...base,
      discovery: notes([{ id: "note-1", amount: 999n, createdBlock: NOTE_BLOCK }]),
      claimNote,
    });
    expect(result.ok).toBe(false);
    expect(claimNote).not.toHaveBeenCalled();
  });
});

describe("Flow A — discovery that reports no creation block", () => {
  // The SDK's discovery returns created: 0 for every note. Treating that as a
  // real block number made the block filter reject every genuine payment,
  // because no transaction is ever mined in block 0.
  const base = {
    txHash: "0xabc",
    claimedAmountWei: 1_500_000n,
    tokenAddress: STRK_ADDR,
    networkIndex: 2,
  };

  beforeEach(() => {
    mockReceipt = { execution_status: "SUCCEEDED", block_number: 14_466_296, events: [] };
  });

  it("credits a matching note when discovery reports block 0", async () => {
    const claimed: string[] = [];
    const result = await verifyFlowADeposit({
      ...base,
      discovery: { listNotes: async () => [{ id: "note-1", amount: 1_500_000n, createdBlock: 0 }] },
      claimNote: async (id: string) => {
        claimed.push(id);
        return true;
      },
    });
    expect(result).toEqual({ ok: true, amountWei: 1_500_000n });
    expect(claimed).toEqual(["note-1"]);
  });

  it("still refuses a note already credited to another deposit", async () => {
    const result = await verifyFlowADeposit({
      ...base,
      discovery: { listNotes: async () => [{ id: "note-1", amount: 1_500_000n, createdBlock: 0 }] },
      claimNote: async () => false,
    });
    expect(result.ok).toBe(false);
  });

  it("still refuses an amount no note matches", async () => {
    const result = await verifyFlowADeposit({
      ...base,
      discovery: { listNotes: async () => [{ id: "note-1", amount: 999n, createdBlock: 0 }] },
      claimNote: async () => true,
    });
    expect(result.ok).toBe(false);
  });
});
