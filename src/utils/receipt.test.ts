import { describe, expect, it } from "vitest";
import { errorResult, fmtStrk, prettyStatus, shortHex } from "./receipt";

describe("fmtStrk", () => {
  it("formats a whole-STRK amount with no fractional part", () => {
    expect(fmtStrk(5n * 10n ** 18n)).toBe("5");
  });

  it("formats a fractional amount and trims trailing zeros", () => {
    expect(fmtStrk(1n * 10n ** 18n + 5n * 10n ** 17n)).toBe("1.5");
  });

  it("formats zero", () => {
    expect(fmtStrk(0n)).toBe("0");
  });

  it("pads and trims small fractional amounts correctly", () => {
    // 1 wei = 0.000000000000000001 STRK
    expect(fmtStrk(1n)).toBe("0.000000000000000001");
  });
});

describe("shortHex", () => {
  it("leaves short hex untouched", () => {
    expect(shortHex("0x1927a")).toBe("0x1927a");
  });

  it("truncates long hex to a 7-char head and 4-char tail", () => {
    const long = "0x1dc5a1c00000000000000000000000000000001927a";
    const result = shortHex(long);
    expect(result).toBe("0x1dc5a...927a");
  });
});

describe("prettyStatus", () => {
  it("combines finality and execution status", () => {
    expect(prettyStatus("ACCEPTED_ON_L2", "SUCCEEDED")).toBe("Accepted on L2 · Succeeded");
  });

  it("handles L1 finality", () => {
    expect(prettyStatus("ACCEPTED_ON_L1", "SUCCEEDED")).toBe("Accepted on L1 · Succeeded");
  });

  it("handles a reverted execution", () => {
    expect(prettyStatus("ACCEPTED_ON_L2", "REVERTED")).toBe("Accepted on L2 · Reverted");
  });

  it("falls back to Confirmed when neither status is known", () => {
    expect(prettyStatus(undefined, undefined)).toBe("Confirmed");
  });
});

describe("errorResult", () => {
  it("shapes an error message into an ActionResult", () => {
    const result = errorResult("something broke");
    expect(result.status).toBe("error");
    expect(result.title).toBe("Action failed");
    expect(result.note).toBe("something broke");
  });
});
