import { describe, expect, it } from "vitest";
import { Strk20Networks, TokenSymbols, tokenAddressFor, isTokenSymbol } from "./constants";

// A payout passes a token to the privacy pool as a felt, and the pool wants
// the ERC-20 contract. Passing the *symbol* instead threw "Cannot convert
// USDC to a BigInt" and broke every payout — on a path whose only successful
// rows in the database turned out to be fixtures written before the executor
// existed, so nothing caught it.
//
// The invariant is small and worth pinning: for every token Nomos prices, on
// every network it supports, the configured address must be a felt the SDK
// can accept.
describe("token contract addresses", () => {
  const networks = Object.keys(Strk20Networks).map(Number);

  for (const network of networks) {
    for (const token of TokenSymbols) {
      it(`${token} on ${Strk20Networks[network]} resolves to a usable felt`, () => {
        const address = tokenAddressFor(token, network);
        expect(address).not.toBe("0x0");
        expect(() => BigInt(address)).not.toThrow();
        expect(BigInt(address)).toBeGreaterThan(0n);
      });
    }
  }

  it("never accepts a bare symbol as an address", () => {
    // The exact shape of the bug: a symbol reaching BigInt().
    for (const token of TokenSymbols) {
      expect(() => BigInt(token)).toThrow();
      expect(isTokenSymbol(token)).toBe(true);
    }
  });

  it("reports an unconfigured pairing rather than returning something unusable", () => {
    expect(tokenAddressFor("USDC", 999)).toBe("0x0");
  });

  it("keeps USDC network-specific, because the contracts genuinely differ", () => {
    // Both networks have two contracts calling themselves USDC, and the pool
    // custodies only one of each. Paying out against the other finds no notes
    // and fails deep inside proving with "insufficient balance".
    expect(tokenAddressFor("USDC", 0)).not.toBe(tokenAddressFor("USDC", 2));
  });

  it("keeps STRK on its one canonical address across networks", () => {
    // Unlike USDC, STRK really is deployed at the same address on mainnet and
    // Sepolia. Asserted so that a future edit "fixing" the duplication has to
    // be a deliberate choice.
    expect(tokenAddressFor("STRK", 0)).toBe(tokenAddressFor("STRK", 2));
  });
});
