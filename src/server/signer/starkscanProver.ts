// Proof provider for the Starkscan-hosted STRK20 prover relay (Mainnet).
//
// The SDK's own ProvingServiceProofProvider cannot talk to it. That one makes
// a single synchronous JSON-RPC call and expects the proof in the response;
// the relay is an asynchronous job API — POST returns 202 with a jobId, and
// the proof arrives from a separate polling endpoint — behind an API-key
// header the SDK has no option for. So `prove` is reimplemented here against
// https://starkscan.co/docs/api/strk20-prover.
//
// getDefaultDetails is *not* reimplemented: it returns fixed invocation
// details derived from the chain id, and the SDK's version is delegated to
// rather than copied, so the magic constants inside it stay in one place.
// Constructed without a nodeUrl it performs no I/O.
import { randomUUID } from "node:crypto";
import {
  ProvingServiceProofProvider,
  type Proof,
  type ProofInvocation,
  type ProofInvocationFactoryDetails,
  type ProofProviderInterface,
  type ProvingBlockId,
} from "@starkware-libs/starknet-privacy-sdk";
import type { constants } from "starknet";

export const STARKSCAN_PROVER_URL_MAINNET = "https://api.starkscan.co/v1/SN_MAIN/prove";

/** Terminal relay states that are not a proof. */
export class StarkscanProverError extends Error {
  constructor(
    message: string,
    readonly code?: string | number,
    /** True only where the docs say a retry is safe. */
    readonly retryable = false
  ) {
    super(message);
    this.name = "StarkscanProverError";
  }
}

type JobResponse = {
  jobId: string;
  status: "queued" | "dispatched" | "succeeded" | "failed" | "unavailable" | "unknown_delivery";
  terminal: boolean;
  pollAfterSeconds?: number;
  queuePosition?: number;
  error?: { code?: string | number; message?: string; source?: string };
  resultUnavailableReason?: string;
  result?: {
    proof: string;
    proof_facts?: string[];
    l2_to_l1_messages?: { from_address?: string; payload?: string[] }[];
    additional_data?: Proof["additionalData"];
  };
};

export type StarkscanProofProviderOptions = {
  baseUrl?: string;
  /** Ceiling on one prove() call, across submit + polling. */
  maxWaitMs?: number;
  requestTimeoutMs?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// block_id goes on the wire as "latest" | {block_number} | {block_hash}; a
// bare number is the shape our callers use (currentBlock - 10).
function toBlockId(id: ProvingBlockId | undefined): unknown {
  if (id === undefined) return "latest";
  if (typeof id === "number") return { block_number: id };
  if (typeof id === "string") return id.startsWith("0x") ? { block_hash: id } : id;
  return id;
}

export class StarkscanProofProvider implements ProofProviderInterface {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxWaitMs: number;
  private readonly requestTimeoutMs: number;
  private readonly details: ProvingServiceProofProvider;

  constructor(apiKey: string, chainId: constants.StarknetChainId, options: StarkscanProofProviderOptions = {}) {
    if (!apiKey) throw new Error("StarkscanProofProvider requires an API key.");
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? STARKSCAN_PROVER_URL_MAINNET).replace(/\/+$/, "");
    this.maxWaitMs = options.maxWaitMs ?? 10 * 60_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    // URL is unused: without a nodeUrl this only ever returns static details.
    this.details = new ProvingServiceProofProvider(this.baseUrl, chainId);
  }

  getDefaultDetails(): Promise<ProofInvocationFactoryDetails> {
    return this.details.getDefaultDetails();
  }

  async prove(invocation: ProofInvocation, blockIdentifier?: ProvingBlockId): Promise<Proof> {
    const deadline = Date.now() + this.maxWaitMs;
    // One key per prove() call. Reused deliberately on `unavailable`, which
    // the docs single out as safe to retry with the *same* key — that is what
    // stops a retry paying for a second proof of the same transaction.
    const idempotencyKey = randomUUID();

    let job = await this.submit(invocation, blockIdentifier, idempotencyKey, deadline);
    while (!job.terminal) {
      if (Date.now() > deadline) {
        throw new StarkscanProverError(`Proving timed out after ${this.maxWaitMs}ms (job ${job.jobId}, status ${job.status}).`);
      }
      await sleep(Math.max(1, job.pollAfterSeconds ?? 5) * 1000);
      job = await this.request("GET", `${this.baseUrl}/${job.jobId}`);
    }

    if (job.status === "succeeded") return this.toProof(invocation, job);

    // `unavailable` means the relay knows the prover never got it, so the same
    // key can safely go again. Everything else terminal is not ours to retry:
    // in particular the docs are explicit that unknown_delivery must not be
    // auto-resubmitted, since the prover may have received it after all.
    if (job.status === "unavailable" && Date.now() < deadline) {
      job = await this.submit(invocation, blockIdentifier, idempotencyKey, deadline);
      while (!job.terminal && Date.now() < deadline) {
        await sleep(Math.max(1, job.pollAfterSeconds ?? 5) * 1000);
        job = await this.request("GET", `${this.baseUrl}/${job.jobId}`);
      }
      if (job.status === "succeeded") return this.toProof(invocation, job);
    }

    if (job.status === "unknown_delivery") {
      throw new StarkscanProverError(
        `Prover delivery unknown for job ${job.jobId}. Do not auto-resubmit — the prover may still have it. ` +
          `Resubmit manually with a new idempotency key once the outcome is known.`,
        job.error?.code ?? "prover_delivery_unknown"
      );
    }
    throw new StarkscanProverError(
      `Proving ${job.status} for job ${job.jobId}: ${job.error?.message ?? "no message"}`,
      job.error?.code
    );
  }

  private toProof(invocation: ProofInvocation, job: JobResponse): Proof {
    const result = job.result;
    if (!result?.proof) {
      throw new StarkscanProverError(
        `Job ${job.jobId} succeeded without a proof${job.resultUnavailableReason ? ` (${job.resultUnavailableReason})` : ""}. ` +
          `The relay delivers a result once; it cannot be fetched again.`,
        job.resultUnavailableReason
      );
    }
    // Same extraction the SDK performs: the pool's L2-to-L1 payload is
    // [class_hash, ...serialized_actions], and the consumer strips the prefix.
    const pool = String(invocation.sender_address).toLowerCase();
    const output = result.l2_to_l1_messages?.find((m) => m.from_address?.toLowerCase() === pool)?.payload ?? [];
    return {
      data: result.proof,
      output,
      proofFacts: result.proof_facts ?? [],
      additionalData: result.additional_data,
    };
  }

  private async submit(
    invocation: ProofInvocation,
    blockIdentifier: ProvingBlockId | undefined,
    idempotencyKey: string,
    deadline: number
  ): Promise<JobResponse> {
    const body = JSON.stringify({ block_id: toBlockId(blockIdentifier), transaction: invocation });
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request("POST", this.baseUrl, body, idempotencyKey);
      } catch (err) {
        const retryable = err instanceof StarkscanProverError && err.retryable;
        const backoff = Math.min(2000 * 2 ** attempt, 30_000);
        if (!retryable || attempt >= 4 || Date.now() + backoff > deadline) throw err;
        await sleep(backoff);
      }
    }
  }

  private async request(method: "GET" | "POST", url: string, body?: string, idempotencyKey?: string): Promise<JobResponse> {
    const headers: Record<string, string> = { "X-Starkscan-Api-Key": this.apiKey };
    if (body) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(this.requestTimeoutMs) });
    const text = await res.text();

    if (!res.ok) {
      let code: string | number | undefined;
      let message = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text);
        code = parsed?.error?.code ?? parsed?.code;
        message = parsed?.error?.message ?? parsed?.message ?? message;
      } catch {
        /* non-JSON body; the status carries the meaning */
      }
      // Daily budget is a hard stop until 00:00 UTC — retrying only burns time.
      if (res.status === 429 && String(code) === "prover_daily_budget_exhausted") {
        const retryAfter = res.headers.get("Retry-After");
        throw new StarkscanProverError(
          `Starkscan prover daily budget exhausted${retryAfter ? `; retry after ${retryAfter}s` : " (resets 00:00 UTC)"}.`,
          code
        );
      }
      const retryable = res.status === 429 || res.status === 503;
      throw new StarkscanProverError(`Starkscan prover HTTP ${res.status}: ${message}`, code, retryable);
    }
    return JSON.parse(text) as JobResponse;
  }
}
