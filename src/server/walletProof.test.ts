import { describe, expect, it, vi } from "vitest";
import {
  CHALLENGE_TTL_SECONDS,
  challengeIsValid,
  issueChallenge,
  loginTypedData,
} from "./walletProof";

const ADDR = "0x" + "a".repeat(63);
const OTHER = "0x" + "b".repeat(63);

describe("challenges", () => {
  it("accepts one it just issued", () => {
    expect(challengeIsValid(issueChallenge(ADDR, 2), ADDR, 2)).toBe(true);
  });

  it("is case-insensitive about the address, as the session cookie is", () => {
    expect(challengeIsValid(issueChallenge(ADDR.toUpperCase(), 2), ADDR, 2)).toBe(true);
  });

  it("refuses one minted for a different address", () => {
    // Otherwise an attacker mints a challenge for their own wallet, signs it
    // honestly, and presents it as proof of owning someone else's.
    expect(challengeIsValid(issueChallenge(OTHER, 2), ADDR, 2)).toBe(false);
  });

  it("refuses one minted for a different network", () => {
    expect(challengeIsValid(issueChallenge(ADDR, 2), ADDR, 0)).toBe(false);
  });

  it("refuses one that has expired", () => {
    const issued = issueChallenge(ADDR, 2, 1_000_000_000_000);
    const afterwards = 1_000_000_000_000 + (CHALLENGE_TTL_SECONDS + 1) * 1000;
    expect(challengeIsValid(issued, ADDR, 2, afterwards)).toBe(false);
  });

  it("still accepts one inside its window", () => {
    const issued = issueChallenge(ADDR, 2, 1_000_000_000_000);
    const afterwards = 1_000_000_000_000 + (CHALLENGE_TTL_SECONDS - 10) * 1000;
    expect(challengeIsValid(issued, ADDR, 2, afterwards)).toBe(true);
  });

  it("refuses a forged one", () => {
    const real = issueChallenge(ADDR, 2);
    const body = real.slice(0, real.lastIndexOf("."));
    expect(challengeIsValid(`${body}.notarealsignature`, ADDR, 2)).toBe(false);
  });

  it("refuses a tampered payload carrying a real signature", () => {
    const real = issueChallenge(OTHER, 2);
    const sig = real.slice(real.lastIndexOf(".") + 1);
    const swapped = Buffer.from(JSON.stringify({ a: ADDR, n: 2, iat: Date.now() / 1000, r: "x" })).toString(
      "base64url"
    );
    expect(challengeIsValid(`${swapped}.${sig}`, ADDR, 2)).toBe(false);
  });

  it("refuses junk", () => {
    for (const junk of ["", ".", "no-dot", "a.b.c"]) {
      expect(challengeIsValid(junk, ADDR, 2)).toBe(false);
    }
  });

  it("does not issue the same challenge twice", () => {
    expect(issueChallenge(ADDR, 2)).not.toBe(issueChallenge(ADDR, 2));
  });
});

describe("loginTypedData", () => {
  it("carries the challenge, so a signature is good for one login only", () => {
    const challenge = issueChallenge(ADDR, 2);
    expect((loginTypedData(challenge, 2).message as Record<string, unknown>).challenge).toBe(challenge);
  });

  it("is bound to the network, so a Sepolia signature is not a mainnet one", () => {
    const challenge = issueChallenge(ADDR, 2);
    const sepolia = loginTypedData(challenge, 2).domain.chainId;
    const mainnet = loginTypedData(challenge, 0).domain.chainId;
    expect(sepolia).not.toBe(mainnet);
  });

  it("says plainly that it authorises no payment", () => {
    const message = loginTypedData(issueChallenge(ADDR, 2), 2).message as Record<string, string>;
    expect(message.statement).toMatch(/does not authorise any payment/i);
  });
});
