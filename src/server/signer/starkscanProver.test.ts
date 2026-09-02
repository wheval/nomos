// The relay's terminal states are the part worth pinning down: each one
// decides whether a payout retries, stops, or needs a human, and getting that
// wrong either burns a rate-limited proof or double-spends a note.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { constants } from "starknet";
import { StarkscanProofProvider, StarkscanProverError } from "./starkscanProver";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const invocation = { sender_address: POOL } as never;

// pollAfterSeconds is honoured with real timers, so tests use 0 to stay fast.
function provider(overrides = {}) {
  return new StarkscanProofProvider("test-key", constants.StarknetChainId.SN_MAIN, {
    baseUrl: "https://relay.test/v1/SN_MAIN/prove",
    maxWaitMs: 5_000,
    ...overrides,
  });
}

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

const succeeded = {
  jobId: "prv_1",
  status: "succeeded",
  terminal: true,
  result: {
    proof: "0xproof",
    proof_facts: ["0xfact"],
    l2_to_l1_messages: [{ from_address: POOL, payload: ["0xclass", "0xaction"] }],
  },
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("StarkscanProofProvider", () => {
  it("submits with the API key and an idempotency key, then polls to the proof", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(202, { jobId: "prv_1", status: "queued", terminal: false, pollAfterSeconds: 0 }))
      .mockResolvedValueOnce(reply(200, { jobId: "prv_1", status: "dispatched", terminal: false, pollAfterSeconds: 0 }))
      .mockResolvedValueOnce(reply(200, succeeded));

    const proof = await provider().prove(invocation, 500);

    expect(proof).toEqual({
      data: "0xproof",
      output: ["0xclass", "0xaction"],
      proofFacts: ["0xfact"],
      additionalData: undefined,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://relay.test/v1/SN_MAIN/prove");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Starkscan-Api-Key"]).toBe("test-key");
    expect(init.headers["Idempotency-Key"]).toMatch(/^[\w-]{16,128}$/);
    // A bare block number has to go on the wire as {block_number}.
    expect(JSON.parse(init.body).block_id).toEqual({ block_number: 500 });

    // Polling is a GET against the job, and must still carry the key.
    const [pollUrl, pollInit] = fetchMock.mock.calls[1];
    expect(pollUrl).toBe("https://relay.test/v1/SN_MAIN/prove/prv_1");
    expect(pollInit.method).toBe("GET");
    expect(pollInit.headers["X-Starkscan-Api-Key"]).toBe("test-key");
  });

  it("never auto-resubmits on unknown_delivery", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(202, { jobId: "prv_2", status: "unknown_delivery", terminal: true, error: { code: "prover_delivery_unknown" } })
    );

    await expect(provider().prove(invocation, 500)).rejects.toThrow(/Do not auto-resubmit/);
    // Exactly one call: the prover may have received it, so a retry here
    // risks paying twice and proving the same notes twice.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries `unavailable` reusing the same idempotency key", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(202, { jobId: "prv_3", status: "unavailable", terminal: true }))
      .mockResolvedValueOnce(reply(202, succeeded));

    const proof = await provider().prove(invocation, 500);
    expect(proof.data).toBe("0xproof");

    const first = fetchMock.mock.calls[0][1].headers["Idempotency-Key"];
    const second = fetchMock.mock.calls[1][1].headers["Idempotency-Key"];
    // Same key: the docs call this safe, and it stops the retry being billed
    // as a second proof of the same transaction.
    expect(second).toBe(first);
  });

  it("stops immediately when the daily budget is exhausted", async () => {
    fetchMock.mockResolvedValue(
      reply(429, { error: { code: "prover_daily_budget_exhausted" } }, { "Retry-After": "3600" })
    );

    await expect(provider().prove(invocation, 500)).rejects.toThrow(/daily budget exhausted.*3600/s);
    // No backoff loop — the quota is fixed until 00:00 UTC.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries transient queue-full responses", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(503, { error: { code: "prover_queue_full" } }))
      .mockResolvedValueOnce(reply(202, succeeded));

    const proof = await provider({ maxWaitMs: 60_000 }).prove(invocation, 500);
    expect(proof.data).toBe("0xproof");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a delivered-once result that arrived empty", async () => {
    fetchMock.mockImplementation(async () =>
      reply(202, { jobId: "prv_4", status: "succeeded", terminal: true, resultUnavailableReason: "delivered_or_expired" })
    );

    const err = await provider().prove(invocation, 500).catch((e) => e);
    expect(err).toBeInstanceOf(StarkscanProverError);
    expect(err.message).toMatch(/delivered_or_expired/);
    expect(err.message).toMatch(/delivers a result once/);
  });

  it("requires an API key", () => {
    expect(() => new StarkscanProofProvider("", constants.StarknetChainId.SN_MAIN)).toThrow(/API key/);
  });
});
