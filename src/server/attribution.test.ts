import { beforeEach, describe, expect, it, vi } from "vitest";

// Settling a private payment consumes the note that identifies it. The claim
// is what stops one note being credited twice, so it has to happen before the
// deposit is recorded — which leaves everything after it in a window where a
// failure would consume the note, credit nobody, and leave no sweep able to
// retry. The money would sit on-chain, permanently unattributable.

const getPaymentIntent = vi.fn();
const listClaimedNoteIds = vi.fn(async () => new Set<string>());
const claimShieldedNote = vi.fn(async () => true);
const releaseShieldedNote = vi.fn(async () => {});
const recordDeposit = vi.fn(async () => ({ deposit: { id: "dep-1", reference: "nx_1" } }));
const creditLedger = vi.fn(async () => ({}) as never);
const matchPaymentIntent = vi.fn(async () => true);
const getDepositById = vi.fn(async () => null);
const listNotes = vi.fn(async () => [{ id: "note-1", amount: 1_500_000n }]);
const deliverPaymentWebhook = vi.fn(async () => {});

vi.mock("@/server/store", () => ({
  getStore: () => ({
    getPaymentIntent, listClaimedNoteIds, claimShieldedNote, releaseShieldedNote,
    recordDeposit, creditLedger, matchPaymentIntent, getDepositById,
  }),
}));
vi.mock("@/server/signer/noteDiscovery", () => ({
  getNoteDiscoveryClient: () => ({ listNotes }),
}));
vi.mock("@/utils/webhook", () => ({ deliverPaymentWebhook }));

const { settleIntentFromChain } = await import("./attribution");

const INTENT = {
  id: "intent-1",
  merchantAddress: "0xmerchant",
  networkIndex: 2,
  token: "USDC",
  amountWei: 1_500_000n,
  status: "open",
  linkId: "link-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  getPaymentIntent.mockResolvedValue({ ...INTENT });
  listClaimedNoteIds.mockResolvedValue(new Set());
  claimShieldedNote.mockResolvedValue(true);
  listNotes.mockResolvedValue([{ id: "note-1", amount: 1_500_000n }]);
  recordDeposit.mockResolvedValue({ deposit: { id: "dep-1", reference: "nx_1" } });
  creditLedger.mockResolvedValue({} as never);
});

describe("settleIntentFromChain", () => {
  it("settles a matching note and keeps the claim", async () => {
    const result = await settleIntentFromChain("intent-1");
    expect(result).toMatchObject({ settled: true, reference: "nx_1" });
    expect(claimShieldedNote).toHaveBeenCalledWith("note-1", 2);
    expect(releaseShieldedNote).not.toHaveBeenCalled();
  });

  it("gives the note back when recording the deposit fails", async () => {
    recordDeposit.mockRejectedValue(new Error("database unavailable"));
    const result = await settleIntentFromChain("intent-1");
    expect(result).toMatchObject({ settled: false, reason: "error" });
    expect(releaseShieldedNote).toHaveBeenCalledWith("note-1", 2);
  });

  it("gives the note back when crediting fails", async () => {
    // The exact shape that broke payouts: a credit rejected by a constraint.
    creditLedger.mockRejectedValue(new Error('violates check constraint "ledger_entries_kind_check"'));
    await settleIntentFromChain("intent-1");
    expect(releaseShieldedNote).toHaveBeenCalledWith("note-1", 2);
  });

  it("can settle on a later attempt once the note is back", async () => {
    creditLedger.mockRejectedValueOnce(new Error("transient"));
    expect(await settleIntentFromChain("intent-1")).toMatchObject({ settled: false });
    expect(await settleIntentFromChain("intent-1")).toMatchObject({ settled: true });
  });

  it("does not claim anything when no note matches the reserved amount", async () => {
    listNotes.mockResolvedValue([{ id: "other", amount: 999n }]);
    expect(await settleIntentFromChain("intent-1")).toMatchObject({ settled: false, reason: "not-arrived" });
    expect(claimShieldedNote).not.toHaveBeenCalled();
  });

  it("leaves a note another caller already claimed alone", async () => {
    claimShieldedNote.mockResolvedValue(false);
    expect(await settleIntentFromChain("intent-1")).toMatchObject({ settled: false, reason: "not-arrived" });
    expect(releaseShieldedNote).not.toHaveBeenCalled();
  });

  it("reports an unknown intent rather than guessing", async () => {
    getPaymentIntent.mockResolvedValue(null);
    expect(await settleIntentFromChain("nope")).toMatchObject({ settled: false, reason: "no-intent" });
  });
});
