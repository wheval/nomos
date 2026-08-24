// JSON-file Store implementation — today's `.data/*.json` behavior from the
// pre-ledger src/utils/store.ts, adapted to the new interface. Convenient
// for local dev; still NOT durable on Vercel's serverless filesystem. Use
// the Supabase driver for anything that needs to survive a deploy.
//
// Server-only: imports `fs`, never bundled into client code by Next.js
// route handlers. Amounts are stored as decimal strings (JSON has no
// bigint) and parsed back to bigint on read.
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import {
  type CreatePayoutInput,
  type Deposit,
  type DepositStatus,
  InsufficientBalanceError,
  type LedgerEntry,
  type LedgerKind,
  type MerchantKey,
  type Payout,
  type PayoutStatus,
  type RecordDepositInput,
  type Store,
} from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const MERCHANTS_FILE = path.join(DATA_DIR, "merchants.json");
const DEPOSITS_FILE = path.join(DATA_DIR, "deposits.json");
const LEDGER_FILE = path.join(DATA_DIR, "ledger.json");
const PAYOUTS_FILE = path.join(DATA_DIR, "payouts.json");

type StoredDeposit = Omit<Deposit, "amountWei"> & { amountWei: string };
type StoredLedgerEntry = Omit<LedgerEntry, "amountWei" | "runningBalanceWei"> & {
  amountWei: string;
  runningBalanceWei: string;
};
type StoredPayout = Omit<Payout, "amountWei"> & { amountWei: string };

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

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomKey(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(18).toString("hex")}`;
}

function toStoredDeposit(d: Deposit): StoredDeposit {
  return { ...d, amountWei: d.amountWei.toString() };
}
function fromStoredDeposit(d: StoredDeposit): Deposit {
  return { ...d, amountWei: BigInt(d.amountWei) };
}
function toStoredLedger(e: LedgerEntry): StoredLedgerEntry {
  return { ...e, amountWei: e.amountWei.toString(), runningBalanceWei: e.runningBalanceWei.toString() };
}
function toStoredPayout(p: Payout): StoredPayout {
  return { ...p, amountWei: p.amountWei.toString() };
}
function fromStoredPayout(p: StoredPayout): Payout {
  return { ...p, amountWei: BigInt(p.amountWei) };
}

export class FileStore implements Store {
  private async readMerchants(): Promise<Record<string, MerchantKey>> {
    return readJson(MERCHANTS_FILE, {});
  }
  private async writeMerchants(m: Record<string, MerchantKey>) {
    await writeJson(MERCHANTS_FILE, m);
  }
  private async readDeposits(): Promise<StoredDeposit[]> {
    return readJson(DEPOSITS_FILE, []);
  }
  private async writeDeposits(d: StoredDeposit[]) {
    await writeJson(DEPOSITS_FILE, d);
  }
  private async readLedger(): Promise<StoredLedgerEntry[]> {
    return readJson(LEDGER_FILE, []);
  }
  private async writeLedger(l: StoredLedgerEntry[]) {
    await writeJson(LEDGER_FILE, l);
  }
  private async readPayouts(): Promise<StoredPayout[]> {
    return readJson(PAYOUTS_FILE, []);
  }
  private async writePayouts(p: StoredPayout[]) {
    await writeJson(PAYOUTS_FILE, p);
  }

  private async ensureMerchant(address: string) {
    const merchants = await this.readMerchants();
    const key = address.toLowerCase();
    if (!merchants[key]) {
      merchants[key] = { publicKey: "", secretKeyHash: "", createdAt: Math.floor(Date.now() / 1000) };
      await this.writeMerchants(merchants);
    }
  }

  async recordDeposit(input: RecordDepositInput) {
    const deposits = await this.readDeposits();
    const existing = deposits.find((d) => d.txHash === input.txHash);
    if (existing) return { deposit: fromStoredDeposit(existing), alreadyExisted: true };

    await this.ensureMerchant(input.merchantAddress);
    const status: DepositStatus = input.status ?? "pending_verify";
    const deposit: Deposit = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      flow: input.flow,
      txHash: input.txHash,
      amountWei: input.amountWei,
      token: input.token ?? "STRK",
      note: input.note,
      ref: input.ref,
      status,
      recordedAt: Math.floor(Date.now() / 1000),
    };
    deposits.push(toStoredDeposit(deposit));
    await this.writeDeposits(deposits);
    return { deposit, alreadyExisted: false };
  }

  async getDepositByTxHash(txHash: string): Promise<Deposit | null> {
    const deposits = await this.readDeposits();
    const found = deposits.find((d) => d.txHash === txHash);
    return found ? fromStoredDeposit(found) : null;
  }

  async markDepositShielded(depositId: string, shieldTxHash: string): Promise<void> {
    const deposits = await this.readDeposits();
    const d = deposits.find((x) => x.id === depositId);
    if (!d) throw new Error(`No such deposit: ${depositId}`);
    d.status = "shielded";
    d.shieldTxHash = shieldTxHash;
    await this.writeDeposits(deposits);
  }

  async markDepositShieldFailed(depositId: string): Promise<void> {
    const deposits = await this.readDeposits();
    const d = deposits.find((x) => x.id === depositId);
    if (!d) throw new Error(`No such deposit: ${depositId}`);
    d.status = "shield_failed";
    await this.writeDeposits(deposits);
  }

  async listPendingShieldDeposits(): Promise<Deposit[]> {
    const deposits = await this.readDeposits();
    return deposits.filter((d) => d.status === "pending_shield").map(fromStoredDeposit);
  }

  async listDepositsFor(merchantAddress: string): Promise<Deposit[]> {
    const normalized = merchantAddress.toLowerCase();
    const deposits = await this.readDeposits();
    return deposits
      .filter((d) => d.merchantAddress.toLowerCase() === normalized)
      .sort((a, b) => b.recordedAt - a.recordedAt)
      .map(fromStoredDeposit);
  }

  async creditLedger(input: { merchantAddress: string; amountWei: bigint; kind: LedgerKind; depositId?: string }): Promise<LedgerEntry> {
    await this.ensureMerchant(input.merchantAddress);
    const ledger = await this.readLedger();
    const balance = await this.getLedgerBalance(input.merchantAddress);
    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      direction: "credit",
      amountWei: input.amountWei,
      kind: input.kind,
      depositId: input.depositId,
      runningBalanceWei: balance + input.amountWei,
      createdAt: Math.floor(Date.now() / 1000),
    };
    ledger.push(toStoredLedger(entry));
    await this.writeLedger(ledger);
    return entry;
  }

  async debitLedger(input: { merchantAddress: string; amountWei: bigint; kind: LedgerKind; payoutId?: string }): Promise<LedgerEntry> {
    const balance = await this.getLedgerBalance(input.merchantAddress);
    if (balance < input.amountWei) {
      throw new InsufficientBalanceError(input.merchantAddress, input.amountWei, balance);
    }
    const ledger = await this.readLedger();
    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      direction: "debit",
      amountWei: input.amountWei,
      kind: input.kind,
      payoutId: input.payoutId,
      runningBalanceWei: balance - input.amountWei,
      createdAt: Math.floor(Date.now() / 1000),
    };
    ledger.push(toStoredLedger(entry));
    await this.writeLedger(ledger);
    return entry;
  }

  async getLedgerBalance(merchantAddress: string): Promise<bigint> {
    const normalized = merchantAddress.toLowerCase();
    const ledger = await this.readLedger();
    const mine = ledger.filter((e) => e.merchantAddress.toLowerCase() === normalized);
    if (mine.length === 0) return 0n;
    mine.sort((a, b) => a.createdAt - b.createdAt);
    return BigInt(mine[mine.length - 1].runningBalanceWei);
  }

  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    await this.ensureMerchant(input.merchantAddress);
    const payouts = await this.readPayouts();
    const payout: Payout = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      destination: input.destination,
      amountWei: input.amountWei,
      mode: input.mode,
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
    };
    payouts.push(toStoredPayout(payout));
    await this.writePayouts(payouts);
    return payout;
  }

  async updatePayoutStatus(payoutId: string, status: PayoutStatus, txHash?: string): Promise<void> {
    const payouts = await this.readPayouts();
    const p = payouts.find((x) => x.id === payoutId);
    if (!p) throw new Error(`No such payout: ${payoutId}`);
    p.status = status;
    if (txHash) p.txHash = txHash;
    if (status === "confirmed" || status === "failed") p.completedAt = Math.floor(Date.now() / 1000);
    await this.writePayouts(payouts);
  }

  async listPayoutsFor(merchantAddress: string): Promise<Payout[]> {
    const normalized = merchantAddress.toLowerCase();
    const payouts = await this.readPayouts();
    return payouts
      .filter((p) => p.merchantAddress.toLowerCase() === normalized)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(fromStoredPayout);
  }

  async issueMerchantKey(address: string): Promise<{ publicKey: string; secretKey: string }> {
    const merchants = await this.readMerchants();
    const key = address.toLowerCase();
    const publicKey = randomKey("pk");
    const secretKey = randomKey("sk");
    merchants[key] = {
      publicKey,
      secretKeyHash: sha256(secretKey),
      createdAt: merchants[key]?.createdAt ?? Math.floor(Date.now() / 1000),
      webhookUrl: merchants[key]?.webhookUrl,
    };
    await this.writeMerchants(merchants);
    return { publicKey, secretKey };
  }

  async getMerchantPublicKey(address: string): Promise<string | null> {
    const merchants = await this.readMerchants();
    return merchants[address.toLowerCase()]?.publicKey || null;
  }

  async verifyMerchantSecret(address: string, secretKey: string): Promise<boolean> {
    const merchants = await this.readMerchants();
    const record = merchants[address.toLowerCase()];
    if (!record || !record.secretKeyHash) return false;
    return record.secretKeyHash === sha256(secretKey);
  }

  async getMerchantWebhookUrl(address: string): Promise<string | null> {
    const merchants = await this.readMerchants();
    return merchants[address.toLowerCase()]?.webhookUrl ?? null;
  }

  async setMerchantWebhookUrl(address: string, secretKey: string, url: string): Promise<boolean> {
    const merchants = await this.readMerchants();
    const key = address.toLowerCase();
    const record = merchants[key];
    if (!record || record.secretKeyHash !== sha256(secretKey)) return false;
    record.webhookUrl = url || undefined;
    await this.writeMerchants(merchants);
    return true;
  }

  async getWebhookSigningKey(address: string): Promise<string | null> {
    const merchants = await this.readMerchants();
    return merchants[address.toLowerCase()]?.secretKeyHash || null;
  }
}
