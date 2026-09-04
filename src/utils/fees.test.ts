import { describe, expect, it } from "vitest";
import {
  isPricedToken,
  minimumPaymentWei,
  minimumPayoutWei,
  netAfterFee,
  payoutFeeWei,
  transactionFeeWei,
} from "./fees";

// A payout costs ~9.5 STRK on-chain (≈6 pool fee + ≈3.5 gas). At ~$0.026/STRK
// that is ~$0.25, and the pricing only works if fees clear it once payments
// batch. These assert the economics, not just the constants.
const PAYOUT_COST_STRK = 9_500_000_000_000_000_000n;

describe("fee schedule", () => {
  it("prices Flow B above Flow A, because Flow B also costs a shield", () => {
    expect(transactionFeeWei("USDC", "B")).toBeGreaterThan(transactionFeeWei("USDC", "A"));
    expect(transactionFeeWei("STRK", "B")).toBeGreaterThan(transactionFeeWei("STRK", "A"));
  });

  it("charges 0.01/0.02 USDC per transaction and 0.05 to pay out", () => {
    expect(transactionFeeWei("USDC", "A")).toBe(10_000n);
    expect(transactionFeeWei("USDC", "B")).toBe(20_000n);
    expect(payoutFeeWei("USDC")).toBe(50_000n);
  });

  it("knowingly runs below settlement cost while this is a prototype", () => {
    // Prices were cut an order of magnitude so a demo can move $0.20 rather
    // than being floored at $1.10. The payout fee no longer covers the ~9.5
    // STRK a payout costs on-chain, and that is the deliberate trade.
    //
    // Asserted rather than left implicit so the subsidy stays a decision
    // someone made, not a regression nobody noticed — and so restoring
    // sustainable pricing means changing a test on purpose.
    expect(payoutFeeWei("STRK")).toBeLessThan(PAYOUT_COST_STRK);
  });

  it("keeps the minimum payment above its own fee", () => {
    for (const token of ["USDC", "STRK"] as const) {
      expect(minimumPaymentWei(token)).toBeGreaterThan(transactionFeeWei(token, "B"));
    }
  });

  it("keeps the minimum payout above the payout fee", () => {
    for (const token of ["USDC", "STRK"] as const) {
      expect(minimumPayoutWei(token)).toBeGreaterThan(payoutFeeWei(token));
    }
  });
});

describe("netAfterFee", () => {
  it("credits gross less fee", () => {
    expect(netAfterFee(1_000_000n, 100_000n)).toBe(900_000n);
  });

  it("treats a missing fee as no fee, for rows predating pricing", () => {
    expect(netAfterFee(1_000_000n, undefined)).toBe(1_000_000n);
  });

  it("never credits a negative, however small the payment", () => {
    // A payer can send any amount directly, below the minimum or below the
    // fee; the ledger must not go backwards.
    expect(netAfterFee(50_000n, 100_000n)).toBe(0n);
    expect(netAfterFee(0n, 100_000n)).toBe(0n);
  });
});

describe("unpriced tokens", () => {
  it("are reported as unpriced", () => {
    expect(isPricedToken("USDC")).toBe(true);
    expect(isPricedToken("DOGE")).toBe(false);
  });

  it("settle free rather than throwing on money that already moved", () => {
    expect(transactionFeeWei("DOGE", "A")).toBe(0n);
    expect(payoutFeeWei("DOGE")).toBe(0n);
    expect(netAfterFee(1_000n, transactionFeeWei("DOGE", "A"))).toBe(1_000n);
  });
});
