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

  it("does not hand two simultaneous attempts the same amount every time", () => {
    // Reserving is read-then-write, so two attempts on one link can see the
    // same open set. Probing from zero made them pick the same slot with
    // certainty; probing from a random start makes a collision rare. Two
    // intents sharing an amount is the one state attribution cannot resolve.
    const seen = new Set<bigint>();
    for (let i = 0; i < 200; i++) seen.add(uniquePayableAmount(1_500_000n, USDC, []));
    expect(seen.size).toBeGreaterThan(50);
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
