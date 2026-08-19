// Minimal JSON-file store for the sprint's dashboard + API-key demo. This is
// deliberately not a real database - it's the smallest thing that lets the
// merchant dashboard and the API-key-gated read endpoint work end to end
// during the sprint. Swap for Postgres/SQLite before this goes past a demo.
//
// Server-only: imports `fs`, never bundled into client code by Next.js
// route handlers.
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.join(process.cwd(), ".data");
const PAYMENTS_FILE = path.join(DATA_DIR, "payments.json");
const MERCHANTS_FILE = path.join(DATA_DIR, "merchants.json");

export type PaymentRecord = {
  to: string;
  amount: string; // human STRK units, as recorded at payment time
  token: string;
  note?: string;
  ref?: string;
  txHash: string;
  recordedAt: number; // unix seconds
};

export type MerchantKey = {
  publicKey: string;
  secretKeyHash: string; // sha256 hex - the plaintext secret is never stored
  createdAt: number;
  webhookUrl?: string;
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  await ensureDataDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

export async function appendPayment(record: PaymentRecord): Promise<void> {
  const all = await readJson<PaymentRecord[]>(PAYMENTS_FILE, []);
  all.push(record);
  await writeJson(PAYMENTS_FILE, all);
}

export async function listPaymentsFor(to: string): Promise<PaymentRecord[]> {
  const all = await readJson<PaymentRecord[]>(PAYMENTS_FILE, []);
  const normalized = to.toLowerCase();
  return all
    .filter((p) => p.to.toLowerCase() === normalized)
    .sort((a, b) => b.recordedAt - a.recordedAt);
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomKey(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(18).toString("hex")}`;
}

// Create (or rotate) the API key pair for a merchant address. Returns the
// plaintext secret key - shown once, never recoverable again (only its
// hash is persisted). Rotating preserves an existing webhook URL.
export async function issueMerchantKey(address: string): Promise<{ publicKey: string; secretKey: string }> {
  const merchants = await readJson<Record<string, MerchantKey>>(MERCHANTS_FILE, {});
  const key = address.toLowerCase();
  const publicKey = randomKey("pk");
  const secretKey = randomKey("sk");
  merchants[key] = {
    publicKey,
    secretKeyHash: sha256(secretKey),
    createdAt: Math.floor(Date.now() / 1000),
    webhookUrl: merchants[key]?.webhookUrl,
  };
  await writeJson(MERCHANTS_FILE, merchants);
  return { publicKey, secretKey };
}

export async function getMerchantPublicKey(address: string): Promise<string | null> {
  const merchants = await readJson<Record<string, MerchantKey>>(MERCHANTS_FILE, {});
  return merchants[address.toLowerCase()]?.publicKey ?? null;
}

// Verify a bearer secret key belongs to the claimed recipient address.
export async function verifyMerchantSecret(address: string, secretKey: string): Promise<boolean> {
  const merchants = await readJson<Record<string, MerchantKey>>(MERCHANTS_FILE, {});
  const record = merchants[address.toLowerCase()];
  if (!record) return false;
  return record.secretKeyHash === sha256(secretKey);
}

export async function getMerchantWebhookUrl(address: string): Promise<string | null> {
  const merchants = await readJson<Record<string, MerchantKey>>(MERCHANTS_FILE, {});
  return merchants[address.toLowerCase()]?.webhookUrl ?? null;
}

// Set (or clear, with url="") the webhook URL for a merchant. Requires the
// same bearer secret key as reading payments - only the merchant themselves
// can point their own webhook somewhere.
export async function setMerchantWebhookUrl(address: string, secretKey: string, url: string): Promise<boolean> {
  const merchants = await readJson<Record<string, MerchantKey>>(MERCHANTS_FILE, {});
  const key = address.toLowerCase();
  const record = merchants[key];
  if (!record || record.secretKeyHash !== sha256(secretKey)) return false;
  record.webhookUrl = url || undefined;
  await writeJson(MERCHANTS_FILE, merchants);
  return true;
}

// The HMAC key a merchant uses to verify X-Nomos-Signature: it's sha256(their
// own secret key) - the same value Nomos already stores as secretKeyHash, so
// no separate "webhook signing secret" needs to be issued or remembered. The
// merchant computes sha256(secretKey) themselves and HMACs the raw payload
// bytes with it to compare against the header.
export async function getWebhookSigningKey(address: string): Promise<string | null> {
  const merchants = await readJson<Record<string, MerchantKey>>(MERCHANTS_FILE, {});
  return merchants[address.toLowerCase()]?.secretKeyHash ?? null;
}

export function hmacSha256Hex(key: string, payload: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}
