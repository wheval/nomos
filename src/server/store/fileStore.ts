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
  type CreatePaymentLinkInput,
  type CreatePayoutInput,
  type Deposit,
  type DepositStatus,
  InsufficientBalanceError,
  type LedgerEntry,
  type LedgerKind,
  type MerchantKey,
  type NetworkIndex,
  type PaymentLink,
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
const PAYMENT_LINKS_FILE = path.join(DATA_DIR, "payment-links.json");
const CLAIMED_NOTES_FILE = path.join(DATA_DIR, "claimed-notes.json");

type StoredDeposit = Omit<Deposit, "amountWei" | "feeWei"> & { amountWei: string; feeWei?: string };
type StoredLedgerEntry = Omit<LedgerEntry, "amountWei" | "runningBalanceWei"> & {
  amountWei: string;
  runningBalanceWei: string;
};
type StoredPayout = Omit<Payout, "amountWei"> & { amountWei: string };
type StoredPaymentLink = Omit<PaymentLink, "amountWei"> & { amountWei?: string };

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

function merchantKey(address: string, networkIndex: NetworkIndex): string {
  return `${address.toLowerCase()}:${networkIndex}`;
}

function toStoredDeposit(d: Deposit): StoredDeposit {
  return { ...d, amountWei: d.amountWei.toString(), feeWei: d.feeWei.toString() };
}
function fromStoredDeposit(d: StoredDeposit): Deposit {
  // feeWei is optional on disk: rows written before fees existed have none.
  return { ...d, amountWei: BigInt(d.amountWei), feeWei: BigInt(d.feeWei ?? "0") };
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
function toStoredPaymentLink(l: PaymentLink): StoredPaymentLink {
  return { ...l, amountWei: l.amountWei?.toString() };
}
function fromStoredPaymentLink(l: StoredPaymentLink): PaymentLink {
  return { ...l, amountWei: l.amountWei !== undefined ? BigInt(l.amountWei) : undefined };
}

export class FileStore implements Store {
  // The file driver has no transactions, so a debit's read-check-write can
  // interleave with another and overdraw the balance. Chaining per
  // (merchant, token, network) runs them one at a time; unrelated balances
  // still proceed in parallel. Local dev only — Supabase does this properly
  // with a locking function (migration 0009).
  private debitQueues = new Map<string, Promise<unknown>>();

  private serialiseDebit<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.debitQueues.get(key) ?? Promise.resolve();
    // Swallow the predecessor's rejection so one failure can't poison the queue.
    const next = previous.catch(() => {}).then(run);
    this.debitQueues.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }

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
  private async readClaimedNotes(): Promise<string[]> {
    return readJson(CLAIMED_NOTES_FILE, []);
  }

  // The file driver is local dev only and has no transactions, so this races
  // under genuine concurrency. It is honest about that rather than pretending
  // otherwise: Supabase (the deployed driver) enforces the guarantee with a
  // unique index, which is where it actually matters.
  async claimShieldedNote(noteId: string, networkIndex: NetworkIndex): Promise<boolean> {
    const key = `${networkIndex}:${noteId}`;
    const claimed = await this.readClaimedNotes();
    if (claimed.includes(key)) return false;
    claimed.push(key);
    await writeJson(CLAIMED_NOTES_FILE, claimed);
    return true;
  }

  async listClaimedNoteIds(networkIndex: NetworkIndex): Promise<Set<string>> {
    const prefix = `${networkIndex}:`;
    const claimed = await this.readClaimedNotes();
    return new Set(claimed.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)));
  }

  private async readPaymentLinks(): Promise<StoredPaymentLink[]> {
    return readJson(PAYMENT_LINKS_FILE, []);
  }
  private async writePaymentLinks(l: StoredPaymentLink[]) {
    await writeJson(PAYMENT_LINKS_FILE, l);
  }

  private async ensureMerchant(address: string, networkIndex: NetworkIndex) {
    const merchants = await this.readMerchants();
    const key = merchantKey(address, networkIndex);
    if (!merchants[key]) {
      merchants[key] = { publicKey: "", secretKeyHash: "", createdAt: Math.floor(Date.now() / 1000) };
      await this.writeMerchants(merchants);
    }
  }

  async recordDeposit(input: RecordDepositInput) {
    const deposits = await this.readDeposits();
    const existing = deposits.find((d) => d.txHash === input.txHash);
    if (existing) return { deposit: fromStoredDeposit(existing), alreadyExisted: true };

    await this.ensureMerchant(input.merchantAddress, input.networkIndex);
    const status: DepositStatus = input.status ?? "pending_verify";
    const deposit: Deposit = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      networkIndex: input.networkIndex,
      flow: input.flow,
      txHash: input.txHash,
      amountWei: input.amountWei,
      token: input.token ?? "STRK",
      note: input.note,
      ref: input.ref,
      reference: input.reference ?? `nx_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
      linkId: input.linkId,
      status,
      feeWei: input.feeWei ?? 0n,
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

  async getDepositByReference(reference: string): Promise<Deposit | null> {
    const deposits = await this.readDeposits();
    const found = deposits.find((d) => d.reference === reference);
    return found ? fromStoredDeposit(found) : null;
  }

  async listDepositsForLink(linkId: string): Promise<Deposit[]> {
    const deposits = await this.readDeposits();
    return deposits.filter((d) => d.linkId === linkId).map(fromStoredDeposit);
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

  async listDepositsFor(merchantAddress: string, networkIndex: NetworkIndex): Promise<Deposit[]> {
    const normalized = merchantAddress.toLowerCase();
    const deposits = await this.readDeposits();
    return deposits
      .filter((d) => d.merchantAddress.toLowerCase() === normalized && d.networkIndex === networkIndex)
      .sort((a, b) => b.recordedAt - a.recordedAt)
      .map(fromStoredDeposit);
  }

  async creditLedger(input: {
    merchantAddress: string;
    networkIndex: NetworkIndex;
    amountWei: bigint;
    token: string;
    kind: LedgerKind;
    depositId?: string;
  }): Promise<LedgerEntry> {
    await this.ensureMerchant(input.merchantAddress, input.networkIndex);
    const ledger = await this.readLedger();
    const balance = await this.getLedgerBalance(input.merchantAddress, input.token, input.networkIndex);
    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      networkIndex: input.networkIndex,
      direction: "credit",
      amountWei: input.amountWei,
      token: input.token,
      kind: input.kind,
      depositId: input.depositId,
      runningBalanceWei: balance + input.amountWei,
      createdAt: Math.floor(Date.now() / 1000),
    };
    ledger.push(toStoredLedger(entry));
    await this.writeLedger(ledger);
    return entry;
  }

  async debitLedger(input: {
    merchantAddress: string;
    networkIndex: NetworkIndex;
    amountWei: bigint;
    token: string;
    kind: LedgerKind;
    payoutId?: string;
  }): Promise<LedgerEntry> {
    return this.serialiseDebit(
      `${input.merchantAddress.toLowerCase()}:${input.token}:${input.networkIndex}`,
      () => this.debitLedgerUnsafe(input),
    );
  }

  // Only ever called through serialiseDebit.
  private async debitLedgerUnsafe(input: {
    merchantAddress: string;
    networkIndex: NetworkIndex;
    amountWei: bigint;
    token: string;
    kind: LedgerKind;
    payoutId?: string;
  }): Promise<LedgerEntry> {
    const balance = await this.getLedgerBalance(input.merchantAddress, input.token, input.networkIndex);
    if (balance < input.amountWei) {
      throw new InsufficientBalanceError(input.merchantAddress, input.amountWei, balance);
    }
    const ledger = await this.readLedger();
    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      networkIndex: input.networkIndex,
      direction: "debit",
      amountWei: input.amountWei,
      token: input.token,
      kind: input.kind,
      payoutId: input.payoutId,
      runningBalanceWei: balance - input.amountWei,
      createdAt: Math.floor(Date.now() / 1000),
    };
    ledger.push(toStoredLedger(entry));
    await this.writeLedger(ledger);
    return entry;
  }

  async getLedgerBalance(merchantAddress: string, token: string, networkIndex: NetworkIndex): Promise<bigint> {
    const normalized = merchantAddress.toLowerCase();
    const ledger = await this.readLedger();
    const mine = ledger.filter(
      (e) => e.merchantAddress.toLowerCase() === normalized && e.token === token && e.networkIndex === networkIndex
    );
    if (mine.length === 0) return 0n;
    mine.sort((a, b) => a.createdAt - b.createdAt);
    return BigInt(mine[mine.length - 1].runningBalanceWei);
  }

  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    await this.ensureMerchant(input.merchantAddress, input.networkIndex);
    const payouts = await this.readPayouts();
    const payout: Payout = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      networkIndex: input.networkIndex,
      destination: input.destination,
      amountWei: input.amountWei,
      token: input.token,
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

  async listPayoutsFor(merchantAddress: string, networkIndex: NetworkIndex): Promise<Payout[]> {
    const normalized = merchantAddress.toLowerCase();
    const payouts = await this.readPayouts();
    return payouts
      .filter((p) => p.merchantAddress.toLowerCase() === normalized && p.networkIndex === networkIndex)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(fromStoredPayout);
  }

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLink> {
    await this.ensureMerchant(input.merchantAddress, input.networkIndex);
    const links = await this.readPaymentLinks();
    const link: PaymentLink = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      networkIndex: input.networkIndex,
      amountWei: input.amountWei,
      token: input.token,
      note: input.note,
      ref: input.ref ?? randomKey("ref").slice(0, 10).toUpperCase(),
      expiresAt: input.expiresAt,
      revoked: false,
      createdAt: Math.floor(Date.now() / 1000),
      logoDataUrl: input.logoDataUrl,
      singleUse: input.singleUse ?? false,
      callbackUrl: input.callbackUrl,
    };
    links.push(toStoredPaymentLink(link));
    await this.writePaymentLinks(links);
    return link;
  }

  async getPaymentLink(id: string): Promise<PaymentLink | null> {
    const links = await this.readPaymentLinks();
    const found = links.find((l) => l.id === id);
    return found ? fromStoredPaymentLink(found) : null;
  }

  async listPaymentLinksFor(merchantAddress: string, networkIndex: NetworkIndex): Promise<PaymentLink[]> {
    const normalized = merchantAddress.toLowerCase();
    const links = await this.readPaymentLinks();
    return links
      .filter((l) => l.merchantAddress.toLowerCase() === normalized && l.networkIndex === networkIndex)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(fromStoredPaymentLink);
  }

  async revokePaymentLink(id: string, merchantAddress: string): Promise<boolean> {
    const links = await this.readPaymentLinks();
    const link = links.find((l) => l.id === id);
    if (!link || link.merchantAddress.toLowerCase() !== merchantAddress.toLowerCase()) return false;
    link.revoked = true;
    await this.writePaymentLinks(links);
    return true;
  }

  async issueMerchantKey(address: string, networkIndex: NetworkIndex): Promise<{ publicKey: string; secretKey: string }> {
    const merchants = await this.readMerchants();
    const key = merchantKey(address, networkIndex);
    const publicKey = randomKey("pk");
    const secretKey = randomKey("sk");
    merchants[key] = {
      publicKey,
      secretKeyHash: sha256(secretKey),
      createdAt: merchants[key]?.createdAt ?? Math.floor(Date.now() / 1000),
      webhookUrl: merchants[key]?.webhookUrl,
      displayName: merchants[key]?.displayName,
      allowedIps: merchants[key]?.allowedIps,
      logoDataUrl: merchants[key]?.logoDataUrl,
    };
    await this.writeMerchants(merchants);
    return { publicKey, secretKey };
  }

  async getMerchantPublicKey(address: string, networkIndex: NetworkIndex): Promise<string | null> {
    const merchants = await this.readMerchants();
    return merchants[merchantKey(address, networkIndex)]?.publicKey || null;
  }

  async verifyMerchantSecret(address: string, secretKey: string, networkIndex: NetworkIndex): Promise<boolean> {
    const merchants = await this.readMerchants();
    const record = merchants[merchantKey(address, networkIndex)];
    if (!record || !record.secretKeyHash) return false;
    return record.secretKeyHash === sha256(secretKey);
  }

  async getMerchantWebhookUrl(address: string, networkIndex: NetworkIndex): Promise<string | null> {
    const merchants = await this.readMerchants();
    return merchants[merchantKey(address, networkIndex)]?.webhookUrl ?? null;
  }

  async setMerchantWebhookUrl(address: string, secretKey: string, url: string, networkIndex: NetworkIndex): Promise<boolean> {
    const merchants = await this.readMerchants();
    const key = merchantKey(address, networkIndex);
    const record = merchants[key];
    if (!record || record.secretKeyHash !== sha256(secretKey)) return false;
    record.webhookUrl = url || undefined;
    await this.writeMerchants(merchants);
    return true;
  }

  async getWebhookSigningKey(address: string, networkIndex: NetworkIndex): Promise<string | null> {
    const merchants = await this.readMerchants();
    return merchants[merchantKey(address, networkIndex)]?.secretKeyHash || null;
  }

  async getMerchantProfile(address: string, networkIndex: NetworkIndex) {
    const merchants = await this.readMerchants();
    const record = merchants[merchantKey(address, networkIndex)];
    return {
      displayName: record?.displayName?.trim() ? record.displayName : null,
      allowedIps: record?.allowedIps ?? [],
      logoDataUrl: record?.logoDataUrl ?? null,
    };
  }

  async setMerchantDisplayName(address: string, networkIndex: NetworkIndex, displayName: string): Promise<void> {
    await this.ensureMerchant(address, networkIndex);
    const merchants = await this.readMerchants();
    const record = merchants[merchantKey(address, networkIndex)];
    record.displayName = displayName.trim() || undefined;
    await this.writeMerchants(merchants);
  }

  async setMerchantAllowedIps(address: string, networkIndex: NetworkIndex, allowedIps: string[]): Promise<void> {
    await this.ensureMerchant(address, networkIndex);
    const merchants = await this.readMerchants();
    merchants[merchantKey(address, networkIndex)].allowedIps = allowedIps;
    await this.writeMerchants(merchants);
  }

  async setMerchantLogo(address: string, networkIndex: NetworkIndex, logoDataUrl: string | null): Promise<void> {
    await this.ensureMerchant(address, networkIndex);
    const merchants = await this.readMerchants();
    merchants[merchantKey(address, networkIndex)].logoDataUrl = logoDataUrl || undefined;
    await this.writeMerchants(merchants);
  }
}
