import { describe, expect, it } from "vitest";
import { FINGERPRINT_SLOTS, maxFingerprintOverpay, uniquePayableAmount } from "./paymentFingerprint";

const USDC = "USDC";
const STRK = "STRK";

describe("uniquePayableAmount", () => {
  it("returns the price itself when nothing else is pending", () => {
    expect(uniquePayableAmount(1_500_000n, USDC, [], 0n)).toBe(1_500_000n);
  });

  it("steps to the next free slot so two attempts never share an amount", () => {
    expect(uniquePayableAmount(1_500_000n, USDC, [1_500_000n], 0n)).toBe(1_500_001n);
    expect(uniquePayableAmount(1_500_000n, USDC, [1_500_000n, 1_500_001n], 0n)).toBe(1_500_002n);
  });

  it("reuses a freed slot rather than climbing forever", () => {
    // The middle attempt settled and is no longer open.
    expect(uniquePayableAmount(1_500_000n, USDC, [1_500_000n, 1_500_002n], 0n)).toBe(1_500_001n);
  });

  it("ignores amounts belonging to a different price", () => {
    expect(uniquePayableAmount(1_500_000n, USDC, [2_000_000n, 999n], 0n)).toBe(1_500_000n);
  });

  it("costs the payer at most a tenth of a cent in USDC", () => {
    // 999 micro-USDC — below the rounding a payer would ever notice.
    expect(maxFingerprintOverpay(USDC)).toBe(999n);
  });

  it("scales the unit to the token's decimals", () => {
    // STRK has 18 decimals, so a micro-unit is 1e12 wei.
    expect(uniquePayableAmount(10n ** 18n, STRK, [10n ** 18n], 0n)).toBe(10n ** 18n + 10n ** 12n);
  });

  it("wraps past the end of the slot range instead of giving up", () => {
    const last = FINGERPRINT_SLOTS - 1n;
    // Starting on the final slot with it taken, the next probe is slot 0.
    expect(uniquePayableAmount(1_500_000n, USDC, [1_500_000n + last], last)).toBe(1_500_000n);
  });

  it("asks for the price itself when nobody else is mid-payment", () => {
    // The common case by far, and the one a customer sees. A checkout that
    // demands 10.000184 STRK for a 10 STRK donation looks broken.
    expect(uniquePayableAmount(10n ** 19n, STRK, [])).toBe(10n ** 19n);
  });

  it("offsets only to step around an amount already in flight", () => {
    // Ambiguity, not aesthetics, is what the offset buys — so it is spent
    // only when there is ambiguity to avoid.
    const price = 10n ** 19n;
    expect(uniquePayableAmount(price, STRK, [price])).toBe(price + 10n ** 12n);
  });

  it("still never returns an amount another open attempt holds", () => {
    // Whatever the probe start, a taken slot is never handed out twice.
    const taken = [1_500_000n, 1_500_001n, 1_500_002n];
    for (let i = 0; i < 300; i++) {
      expect(taken).not.toContain(uniquePayableAmount(1_500_000n, USDC, taken));
    }
  });

  it("falls back to the plain price when every slot is taken", () => {
    // A payment that is awkward to attribute beats one the payer cannot make.
    const taken = Array.from({ length: Number(FINGERPRINT_SLOTS) }, (_, i) => 1_500_000n + BigInt(i));
    expect(uniquePayableAmount(1_500_000n, USDC, taken, 0n)).toBe(1_500_000n);
  });
});
