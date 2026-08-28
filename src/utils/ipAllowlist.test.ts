import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, ipIsAllowed, normalizeIp, parseIpList } from "./ipAllowlist";

describe("ip allowlist", () => {
  it("treats an empty list as allow-all", () => {
    expect(ipIsAllowed("1.2.3.4", [])).toBe(true);
  });

  it("allows an exact match and rejects others", () => {
    expect(ipIsAllowed("1.2.3.4", ["1.2.3.4"])).toBe(true);
    expect(ipIsAllowed("1.2.3.5", ["1.2.3.4"])).toBe(false);
  });

  it("maps ::1 to 127.0.0.1", () => {
    expect(normalizeIp("::1")).toBe("127.0.0.1");
    expect(ipIsAllowed("::1", ["127.0.0.1"])).toBe(true);
  });

  it("rejects a request with no client IP once a list is set", () => {
    expect(ipIsAllowed(null, ["1.2.3.4"])).toBe(false);
  });

  it("parses a mixed list and reports junk", () => {
    const { ips, invalid } = parseIpList([" 1.2.3.4 ", "nope", "1.2.3.4", "2001:db8::1"]);
    expect(ips).toEqual(["1.2.3.4", "2001:db8::1"]);
    expect(invalid).toEqual(["nope"]);
  });

  it("reads x-forwarded-for first hop", () => {
    const headers = new Headers({ "x-forwarded-for": "8.8.8.8, 1.1.1.1" });
    expect(clientIpFromHeaders(headers)).toBe("8.8.8.8");
  });
});
