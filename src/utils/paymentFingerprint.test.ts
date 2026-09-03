import { describe, expect, it } from "vitest";
import { FINGERPRINT_SLOTS, maxFingerprintOverpay, uniquePayableAmount } from "./paymentFingerprint";

const USDC = "USDC";
const STRK = "STRK";

describe("uniquePayableAmount", () => {
  it("returns the price itself when nothing else is pending", () => {
    expect(uniquePayableAmount(1_500_000n, USDC, [])).toBe(1_500_000n);
  });

  it("steps to the next free slot so two attempts never share an amount", () => {
    expect(uniquePayableAmount(1_500_000n, USDC, [1_500_000n])).toBe(1_500_001n);
    expect(uniquePayableAmount(1_500_000n, USDC, [1_500_000n, 1_500_001n])).toBe(1_500_002n);
  });

  it("reuses a freed slot rather than climbing forever", () => {
    // The middle attempt settled and is no longer open.
    expect(uniquePayableAmount(1_500_000n, USDC, [1_500_000n, 1_500_002n])).toBe(1_500_001n);
  });

  it("ignores amounts belonging to a different price", () => {
    expect(uniquePayableAmount(1_500_000n, USDC, [2_000_000n, 999n])).toBe(1_500_000n);
  });

  it("costs the payer at most a tenth of a cent in USDC", () => {
    // 999 micro-USDC — below the rounding a payer would ever notice.
    expect(maxFingerprintOverpay(USDC)).toBe(999n);
  });

  it("scales the unit to the token's decimals", () => {
    // STRK has 18 decimals, so a micro-unit is 1e12 wei.
    expect(uniquePayableAmount(10n ** 18n, STRK, [10n ** 18n])).toBe(10n ** 18n + 10n ** 12n);
  });

  it("falls back to the plain price when every slot is taken", () => {
    // A payment that is awkward to attribute beats one the payer cannot make.
    const taken = Array.from({ length: Number(FINGERPRINT_SLOTS) }, (_, i) => 1_500_000n + BigInt(i));
    expect(uniquePayableAmount(1_500_000n, USDC, taken)).toBe(1_500_000n);
  });
});
