import { describe, expect, it } from "vitest";
import { csvCell, csvDocument, formatUnits } from "./csv";

describe("csvCell", () => {
  it("leaves ordinary text alone", () => {
    expect(csvCell("Consulting, October")).toBe('"Consulting, October"');
    expect(csvCell("nx_7f21c9")).toBe("nx_7f21c9");
  });

  it("quotes and doubles embedded quotes", () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("quotes newlines so a note cannot invent a row", () => {
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("renders empty for null and undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  // Merchants and payers write notes and references, so this export carries
  // untrusted text into a spreadsheet by definition.
  describe("formula injection", () => {
    it("neutralises every leading character a spreadsheet would evaluate", () => {
      for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
        expect(csvCell(`${lead}cmd`).replace(/^"|"$/g, "")).toMatch(/^'/);
      }
    });

    it("keeps the original text visible rather than dropping it", () => {
      expect(csvCell('=HYPERLINK("http://evil","x")')).toContain("HYPERLINK");
    });

    it("does not mangle a note that merely contains a sign", () => {
      expect(csvCell("order 1+2")).toBe("order 1+2");
    });
  });
});

describe("formatUnits", () => {
  it("does not round away the units a fingerprint lives in", () => {
    // The whole attribution scheme depends on micro-unit differences.
    expect(formatUnits(1_000_001n, 6)).toBe("1.000001");
  });

  it("handles 18 decimals beyond what a float could hold", () => {
    expect(formatUnits(12_345_678_901_234_567_890n, 18)).toBe("12.345678901234567890");
  });

  it("pads the fraction rather than truncating it", () => {
    expect(formatUnits(1n, 6)).toBe("0.000001");
    expect(formatUnits(0n, 6)).toBe("0.000000");
  });

  it("keeps whole amounts exact", () => {
    expect(formatUnits(25_000_000n, 6)).toBe("25.000000");
  });

  it("signs negatives once, on the front", () => {
    expect(formatUnits(-1_500_000n, 6)).toBe("-1.500000");
  });
});

describe("csvDocument", () => {
  it("writes CRLF, which is what Excel expects", () => {
    expect(csvDocument(["a", "b"], [[1, 2]])).toBe("a,b\r\n1,2\r\n");
  });
});
