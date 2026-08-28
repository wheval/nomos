import { describe, expect, it } from "vitest";
import { decodeSession, encodeSession } from "./merchantAuth";

describe("dashboard session cookie", () => {
  it("round-trips a valid session", () => {
    const token = encodeSession("0xABC", 2);
    const session = decodeSession(token);
    expect(session).toEqual(expect.objectContaining({ a: "0xabc", n: 2 }));
  });

  it("rejects a tampered token", () => {
    const token = encodeSession("0xabc", 2);
    expect(decodeSession(token.slice(0, -2) + "zz")).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = encodeSession("0xabc", 2, Date.now() - 16 * 24 * 60 * 60 * 1000);
    expect(decodeSession(token)).toBeNull();
  });
});
