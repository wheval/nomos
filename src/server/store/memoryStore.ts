// In-memory Store implementation. Default for tests/CI (NOMOS_STORE_DRIVER
// unset or "memory") — no external state, resets every process start.
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

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomKey(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(18).toString("hex")}`;
}

export class MemoryStore implements Store {
  private merchants = new Map<string, MerchantKey>();
  private deposits = new Map<string, Deposit>();
  private depositIdByTxHash = new Map<string, string>();
  private ledgerEntries: LedgerEntry[] = [];
  private balances = new Map<string, bigint>();
  private payouts = new Map<string, Payout>();

  private ensureMerchant(address: string) {
    const key = address.toLowerCase();
    if (!this.merchants.has(key)) {
      // A deposit or ledger entry can arrive before a merchant has ever
      // issued an API key (they just connected a wallet and got paid) — a
      // bare record with no key yet is enough to hold their ledger.
      this.merchants.set(key, {
        publicKey: "",
        secretKeyHash: "",
        createdAt: Math.floor(Date.now() / 1000),
      });
    }
  }

  async recordDeposit(input: RecordDepositInput) {
    const existingId = this.depositIdByTxHash.get(input.txHash);
    if (existingId) {
      return { deposit: this.deposits.get(existingId)!, alreadyExisted: true };
    }
    this.ensureMerchant(input.merchantAddress);
    const id = crypto.randomUUID();
    const status: DepositStatus = input.status ?? "pending_verify";
    const deposit: Deposit = {
      id,
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
    this.deposits.set(id, deposit);
    this.depositIdByTxHash.set(input.txHash, id);
    return { deposit, alreadyExisted: false };
  }

  async getDepositByTxHash(txHash: string): Promise<Deposit | null> {
    const id = this.depositIdByTxHash.get(txHash);
    return id ? this.deposits.get(id) ?? null : null;
  }

  async markDepositShielded(depositId: string, shieldTxHash: string): Promise<void> {
    const deposit = this.deposits.get(depositId);
    if (!deposit) throw new Error(`No such deposit: ${depositId}`);
    deposit.status = "shielded";
    deposit.shieldTxHash = shieldTxHash;
  }

  async markDepositShieldFailed(depositId: string): Promise<void> {
    const deposit = this.deposits.get(depositId);
    if (!deposit) throw new Error(`No such deposit: ${depositId}`);
    deposit.status = "shield_failed";
  }

  async listPendingShieldDeposits(): Promise<Deposit[]> {
    return [...this.deposits.values()].filter((d) => d.status === "pending_shield");
  }

  async listDepositsFor(merchantAddress: string): Promise<Deposit[]> {
    const normalized = merchantAddress.toLowerCase();
    return [...this.deposits.values()]
      .filter((d) => d.merchantAddress.toLowerCase() === normalized)
      .sort((a, b) => b.recordedAt - a.recordedAt);
  }

  private balanceKey(merchantAddress: string, token: string): string {
    return `${merchantAddress.toLowerCase()}:${token}`;
  }

  private nextRunningBalance(merchantAddress: string, token: string, delta: bigint): bigint {
    const key = this.balanceKey(merchantAddress, token);
    const current = this.balances.get(key) ?? 0n;
    const next = current + delta;
    this.balances.set(key, next);
    return next;
  }

  async creditLedger(input: { merchantAddress: string; amountWei: bigint; token: string; kind: LedgerKind; depositId?: string }): Promise<LedgerEntry> {
    this.ensureMerchant(input.merchantAddress);
    const runningBalanceWei = this.nextRunningBalance(input.merchantAddress, input.token, input.amountWei);
    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      direction: "credit",
      amountWei: input.amountWei,
      token: input.token,
      kind: input.kind,
      depositId: input.depositId,
      runningBalanceWei,
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.ledgerEntries.push(entry);
    return entry;
  }

  async debitLedger(input: { merchantAddress: string; amountWei: bigint; token: string; kind: LedgerKind; payoutId?: string }): Promise<LedgerEntry> {
    const balance = await this.getLedgerBalance(input.merchantAddress, input.token);
    if (balance < input.amountWei) {
      throw new InsufficientBalanceError(input.merchantAddress, input.amountWei, balance);
    }
    const runningBalanceWei = this.nextRunningBalance(input.merchantAddress, input.token, -input.amountWei);
    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      direction: "debit",
      amountWei: input.amountWei,
      token: input.token,
      kind: input.kind,
      payoutId: input.payoutId,
      runningBalanceWei,
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.ledgerEntries.push(entry);
    return entry;
  }

  async getLedgerBalance(merchantAddress: string, token: string): Promise<bigint> {
    return this.balances.get(this.balanceKey(merchantAddress, token)) ?? 0n;
  }

  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    this.ensureMerchant(input.merchantAddress);
    const payout: Payout = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      destination: input.destination,
      amountWei: input.amountWei,
      token: input.token,
      mode: input.mode,
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.payouts.set(payout.id, payout);
    return payout;
  }

  async updatePayoutStatus(payoutId: string, status: PayoutStatus, txHash?: string): Promise<void> {
    const payout = this.payouts.get(payoutId);
    if (!payout) throw new Error(`No such payout: ${payoutId}`);
    payout.status = status;
    if (txHash) payout.txHash = txHash;
    if (status === "confirmed" || status === "failed") {
      payout.completedAt = Math.floor(Date.now() / 1000);
    }
  }

  async listPayoutsFor(merchantAddress: string): Promise<Payout[]> {
    const normalized = merchantAddress.toLowerCase();
    return [...this.payouts.values()]
      .filter((p) => p.merchantAddress.toLowerCase() === normalized)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async issueMerchantKey(address: string): Promise<{ publicKey: string; secretKey: string }> {
    const key = address.toLowerCase();
    const publicKey = randomKey("pk");
    const secretKey = randomKey("sk");
    const existing = this.merchants.get(key);
    this.merchants.set(key, {
      publicKey,
      secretKeyHash: sha256(secretKey),
      createdAt: existing?.createdAt ?? Math.floor(Date.now() / 1000),
      webhookUrl: existing?.webhookUrl,
    });
    return { publicKey, secretKey };
  }

  async getMerchantPublicKey(address: string): Promise<string | null> {
    const record = this.merchants.get(address.toLowerCase());
    return record?.publicKey || null;
  }

  async verifyMerchantSecret(address: string, secretKey: string): Promise<boolean> {
    const record = this.merchants.get(address.toLowerCase());
    if (!record || !record.secretKeyHash) return false;
    return record.secretKeyHash === sha256(secretKey);
  }

  async getMerchantWebhookUrl(address: string): Promise<string | null> {
    return this.merchants.get(address.toLowerCase())?.webhookUrl ?? null;
  }

  async setMerchantWebhookUrl(address: string, secretKey: string, url: string): Promise<boolean> {
    const key = address.toLowerCase();
    const record = this.merchants.get(key);
    if (!record || record.secretKeyHash !== sha256(secretKey)) return false;
    record.webhookUrl = url || undefined;
    return true;
  }

  async getWebhookSigningKey(address: string): Promise<string | null> {
    return this.merchants.get(address.toLowerCase())?.secretKeyHash || null;
  }
}
