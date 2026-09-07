import { createServer, type Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";

// Webhook delivery against a real HTTP server, not a mocked fetch.
//
// This path is shipped, documented and advertised, and until this test it had
// never delivered a single webhook — no merchant in the live database has a
// webhook URL configured. Mocking fetch would have proved only that the code
// calls fetch; what a merchant depends on is the bytes and headers that
// actually arrive, and above all that the signature they verify against is
// the signature we send.

const SIGNING_KEY = "whsec_test_key";
const getMerchantWebhookUrl = vi.fn(async (): Promise<string | null> => null);
const getWebhookSigningKey = vi.fn(async (): Promise<string | null> => SIGNING_KEY);

vi.mock("@/server/store", () => ({
  getStore: () => ({ getMerchantWebhookUrl, getWebhookSigningKey }),
}));

const { deliverPaymentWebhook } = await import("./webhook");

type Received = { headers: Record<string, string | undefined>; body: string };

let server: Server;
let url: string;
let received: Received[];
let respondWith: number;

beforeEach(async () => {
  vi.clearAllMocks();
  getWebhookSigningKey.mockResolvedValue(SIGNING_KEY);
  received = [];
  respondWith = 200;
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers as Record<string, string | undefined>, body });
      res.writeHead(respondWith).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/hook`;
  getMerchantWebhookUrl.mockResolvedValue(url);
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const deposit = {
  id: "d1",
  merchantAddress: "0xmerchant",
  networkIndex: 2 as const,
  flow: "A" as const,
  txHash: "0xabc",
  amountWei: 25_000_000n,
  feeWei: 10_000n,
  token: "USDC",
  reference: "nx_7f21c9",
  status: "verified" as const,
  recordedAt: 1_700_000_000,
};

describe("webhook delivery, end to end", () => {
  it("delivers a payment event the merchant can act on", async () => {
    await deliverPaymentWebhook(deposit as never);
    expect(received).toHaveLength(1);
    const body = JSON.parse(received[0].body);
    expect(body.event).toBe("payment.received");
    expect(body.data.reference).toBe("nx_7f21c9");
  });

  it("serialises bigint amounts as strings rather than crashing on them", async () => {
    // JSON.stringify throws on a bigint. Every amount in a deposit is one.
    await deliverPaymentWebhook(deposit as never);
    const body = JSON.parse(received[0].body);
    expect(body.data.amountWei).toBe("25000000");
    expect(body.data.feeWei).toBe("10000");
  });

  it("signs the exact bytes it sends, so the merchant's check passes", async () => {
    // The whole point of the signature: recompute it the way the docs tell a
    // merchant to, over the body as received.
    await deliverPaymentWebhook(deposit as never);
    const { headers, body } = received[0];
    const expected = crypto.createHmac("sha256", SIGNING_KEY).update(body).digest("hex");
    expect(headers["x-nomos-signature"]).toBe(`sha256=${expected}`);
  });

  it("does not validate under the wrong key", async () => {
    await deliverPaymentWebhook(deposit as never);
    const { headers, body } = received[0];
    const wrong = crypto.createHmac("sha256", "not-the-key").update(body).digest("hex");
    expect(headers["x-nomos-signature"]).not.toBe(`sha256=${wrong}`);
  });

  it("sends the reference as a header, so a retry can be recognised", async () => {
    await deliverPaymentWebhook(deposit as never);
    expect(received[0].headers["x-nomos-reference"]).toBe("nx_7f21c9");
    expect(received[0].headers["x-nomos-event"]).toBe("payment.received");
  });

  it("stays silent when the merchant has configured no webhook", async () => {
    getMerchantWebhookUrl.mockResolvedValue(null);
    await deliverPaymentWebhook(deposit as never);
    expect(received).toHaveLength(0);
  });

  it("never throws at the caller when the endpoint refuses", async () => {
    // Delivery must not fail a payment that already confirmed on-chain.
    respondWith = 500;
    await expect(deliverPaymentWebhook(deposit as never)).resolves.toBeUndefined();
    expect(received).toHaveLength(1); // first attempt made; retries are backgrounded
  });

  it("never throws at the caller when the endpoint is unreachable", async () => {
    getMerchantWebhookUrl.mockResolvedValue("http://127.0.0.1:1/nowhere");
    await expect(deliverPaymentWebhook(deposit as never)).resolves.toBeUndefined();
  });
});
