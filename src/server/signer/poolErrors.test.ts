import { describe, expect, it } from "vitest";
import { explainPoolError } from "./poolErrors";

// The revert a merchant actually saw in the console: fifteen lines of
// addresses, class hashes and selectors, with the one meaningful word encoded
// as a felt near the end.
const REAL_REVERT =
  "Internal error: Reverted transactions are not supported; hash: TransactionHash(0x5c1190912), " +
  "revert reason: Transaction execution has failed: 0: Error in the called contract (contract address: " +
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91, class hash: 0x007e2bbd7, " +
  "selector: 0x015d40a3): Execution failed. Failure reason: " +
  "0x5355424348414e4e454c5f4e4f545f464f554e44 ('SUBCHANNEL_NOT_FOUND').";

describe("explainPoolError", () => {
  it("tells a merchant what to do about an unregistered destination", () => {
    const message = explainPoolError(new Error(REAL_REVERT));
    expect(message).toMatch(/not set up to receive private payouts/i);
    expect(message).toMatch(/Public \(unshield\)/);
    expect(message).not.toContain("class hash");
  });

  it("does not blame the merchant for a Nomos-side allowance problem", () => {
    const message = explainPoolError(new Error("… Insufficient ERC20 allowance …"));
    expect(message).toMatch(/not something you can fix/i);
    expect(message).toMatch(/was not made/i);
  });

  it("suggests waiting when the notes are simply too new", () => {
    expect(explainPoolError(new Error("Note not mature"))).toMatch(/try again in a minute/i);
  });

  it("keeps an unrecognised revert verbatim rather than guessing at it", () => {
    // A wrong explanation is worse than an ugly one.
    const odd = "Failure reason: 0x1234 ('SOMETHING_NEW').";
    expect(explainPoolError(new Error(odd))).toBe(odd);
  });

  it("handles a thrown non-Error without losing the text", () => {
    expect(explainPoolError("plain string failure")).toBe("plain string failure");
  });
});
