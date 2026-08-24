import { describe, expect, it } from "vitest";
import { buildPaymentUrl, parseStrkAmount } from "./payments";

describe("parseStrkAmount", () => {
  it("parses a whole number into wei", () => {
    expect(parseStrkAmount("5")).toBe(5n * 10n ** 18n);
  });

  it("parses a decimal into wei", () => {
    expect(parseStrkAmount("1.5")).toBe(1n * 10n ** 18n + 5n * 10n ** 17n);
  });

  it("rejects more precision than STRK supports (>18 fractional digits)", () => {
    expect(parseStrkAmount("1." + "1".repeat(19))).toBeNull();
  });

  it("accepts exactly 18 fractional digits", () => {
    expect(parseStrkAmount("0." + "1".repeat(18))).not.toBeNull();
  });

  it("rejects zero", () => {
    expect(parseStrkAmount("0")).toBeNull();
  });

  it("rejects negative numbers", () => {
    expect(parseStrkAmount("-5")).toBeNull();
  });

  it("rejects empty or whitespace-only input", () => {
    expect(parseStrkAmount("")).toBeNull();
    expect(parseStrkAmount("   ")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(parseStrkAmount("abc")).toBeNull();
    expect(parseStrkAmount("5e10")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseStrkAmount("  5  ")).toBe(5n * 10n ** 18n);
  });
});

describe("buildPaymentUrl", () => {
  const origin = "https://nomos.example";

  it("includes only the recipient when no optional params are given", () => {
    const url = buildPaymentUrl(origin, { to: "0xabc" });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/pay");
    expect(parsed.searchParams.get("to")).toBe("0xabc");
    expect(parsed.searchParams.has("amount")).toBe(false);
    expect(parsed.searchParams.has("note")).toBe(false);
    expect(parsed.searchParams.has("ref")).toBe(false);
    expect(parsed.searchParams.has("exp")).toBe(false);
  });

  it("includes every optional param when provided", () => {
    const url = buildPaymentUrl(origin, {
      to: "0xabc",
      amount: "25",
      note: "Invoice #1",
      ref: "REF123",
      exp: "1700000000",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("amount")).toBe("25");
    expect(parsed.searchParams.get("note")).toBe("Invoice #1");
    expect(parsed.searchParams.get("ref")).toBe("REF123");
    expect(parsed.searchParams.get("exp")).toBe("1700000000");
  });
});
