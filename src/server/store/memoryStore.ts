// In-memory Store implementation. Default for tests/CI (NOMOS_STORE_DRIVER
// unset or "memory") — no external state, resets every process start.
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

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomKey(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(18).toString("hex")}`;
}

function merchantKey(address: string, networkIndex: NetworkIndex): string {
  return `${address.toLowerCase()}:${networkIndex}`;
}

export class MemoryStore implements Store {
  private merchants = new Map<string, MerchantKey>();
  private deposits = new Map<string, Deposit>();
  private depositIdByTxHash = new Map<string, string>();
  private ledgerEntries: LedgerEntry[] = [];
  private balances = new Map<string, bigint>();
  private payouts = new Map<string, Payout>();
  private paymentLinks = new Map<string, PaymentLink>();

  private ensureMerchant(address: string, networkIndex: NetworkIndex) {
    const key = merchantKey(address, networkIndex);
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
    this.ensureMerchant(input.merchantAddress, input.networkIndex);
    const id = crypto.randomUUID();
    const status: DepositStatus = input.status ?? "pending_verify";
    const deposit: Deposit = {
      id,
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
      recordedAt: Math.floor(Date.now() / 1000),
    };
    this.deposits.set(id, deposit);
    this.depositIdByTxHash.set(input.txHash, id);
    return { deposit, alreadyExisted: false };
  }

  // Single-threaded in-process: a set insert is already atomic here.
  private claimedNotes = new Set<string>();

  async claimShieldedNote(noteId: string, networkIndex: NetworkIndex): Promise<boolean> {
    const key = `${networkIndex}:${noteId}`;
    if (this.claimedNotes.has(key)) return false;
    this.claimedNotes.add(key);
    return true;
  }

  async getDepositByReference(reference: string): Promise<Deposit | null> {
    for (const d of this.deposits.values()) if (d.reference === reference) return d;
    return null;
  }

  async listDepositsForLink(linkId: string): Promise<Deposit[]> {
    return [...this.deposits.values()].filter((d) => d.linkId === linkId);
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

  async listDepositsFor(merchantAddress: string, networkIndex: NetworkIndex): Promise<Deposit[]> {
    const normalized = merchantAddress.toLowerCase();
    return [...this.deposits.values()]
      .filter((d) => d.merchantAddress.toLowerCase() === normalized && d.networkIndex === networkIndex)
      .sort((a, b) => b.recordedAt - a.recordedAt);
  }

  private balanceKey(merchantAddress: string, token: string, networkIndex: NetworkIndex): string {
    return `${merchantAddress.toLowerCase()}:${token}:${networkIndex}`;
  }

  private nextRunningBalance(merchantAddress: string, token: string, networkIndex: NetworkIndex, delta: bigint): bigint {
    const key = this.balanceKey(merchantAddress, token, networkIndex);
    const current = this.balances.get(key) ?? 0n;
    const next = current + delta;
    this.balances.set(key, next);
    return next;
  }

  async creditLedger(input: {
    merchantAddress: string;
    networkIndex: NetworkIndex;
    amountWei: bigint;
    token: string;
    kind: LedgerKind;
    depositId?: string;
  }): Promise<LedgerEntry> {
    this.ensureMerchant(input.merchantAddress, input.networkIndex);
    const runningBalanceWei = this.nextRunningBalance(input.merchantAddress, input.token, input.networkIndex, input.amountWei);
    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      networkIndex: input.networkIndex,
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

  async debitLedger(input: {
    merchantAddress: string;
    networkIndex: NetworkIndex;
    amountWei: bigint;
    token: string;
    kind: LedgerKind;
    payoutId?: string;
  }): Promise<LedgerEntry> {
    // Read and write with no await between them. Awaiting the balance first
    // yields to the event loop, and two concurrent debits then both check
    // against the same figure and overdraw it.
    const balance = this.balances.get(this.balanceKey(input.merchantAddress, input.token, input.networkIndex)) ?? 0n;
    if (balance < input.amountWei) {
      throw new InsufficientBalanceError(input.merchantAddress, input.amountWei, balance);
    }
    const runningBalanceWei = this.nextRunningBalance(input.merchantAddress, input.token, input.networkIndex, -input.amountWei);
    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      merchantAddress: input.merchantAddress,
      networkIndex: input.networkIndex,
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

  async getLedgerBalance(merchantAddress: string, token: string, networkIndex: NetworkIndex): Promise<bigint> {
    return this.balances.get(this.balanceKey(merchantAddress, token, networkIndex)) ?? 0n;
  }

  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    this.ensureMerchant(input.merchantAddress, input.networkIndex);
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

  async listPayoutsFor(merchantAddress: string, networkIndex: NetworkIndex): Promise<Payout[]> {
    const normalized = merchantAddress.toLowerCase();
    return [...this.payouts.values()]
      .filter((p) => p.merchantAddress.toLowerCase() === normalized && p.networkIndex === networkIndex)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLink> {
    this.ensureMerchant(input.merchantAddress, input.networkIndex);
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
    this.paymentLinks.set(link.id, link);
    return link;
  }

  async getPaymentLink(id: string): Promise<PaymentLink | null> {
    return this.paymentLinks.get(id) ?? null;
  }

  async listPaymentLinksFor(merchantAddress: string, networkIndex: NetworkIndex): Promise<PaymentLink[]> {
    const normalized = merchantAddress.toLowerCase();
    return [...this.paymentLinks.values()]
      .filter((l) => l.merchantAddress.toLowerCase() === normalized && l.networkIndex === networkIndex)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async revokePaymentLink(id: string, merchantAddress: string): Promise<boolean> {
    const link = this.paymentLinks.get(id);
    if (!link || link.merchantAddress.toLowerCase() !== merchantAddress.toLowerCase()) return false;
    link.revoked = true;
    return true;
  }

  async issueMerchantKey(address: string, networkIndex: NetworkIndex): Promise<{ publicKey: string; secretKey: string }> {
    const key = merchantKey(address, networkIndex);
    const publicKey = randomKey("pk");
    const secretKey = randomKey("sk");
    const existing = this.merchants.get(key);
    this.merchants.set(key, {
      publicKey,
      secretKeyHash: sha256(secretKey),
      createdAt: existing?.createdAt ?? Math.floor(Date.now() / 1000),
      webhookUrl: existing?.webhookUrl,
      displayName: existing?.displayName,
      allowedIps: existing?.allowedIps,
      logoDataUrl: existing?.logoDataUrl,
    });
    return { publicKey, secretKey };
  }

  async getMerchantPublicKey(address: string, networkIndex: NetworkIndex): Promise<string | null> {
    const record = this.merchants.get(merchantKey(address, networkIndex));
    return record?.publicKey || null;
  }

  async verifyMerchantSecret(address: string, secretKey: string, networkIndex: NetworkIndex): Promise<boolean> {
    const record = this.merchants.get(merchantKey(address, networkIndex));
    if (!record || !record.secretKeyHash) return false;
    return record.secretKeyHash === sha256(secretKey);
  }

  async getMerchantWebhookUrl(address: string, networkIndex: NetworkIndex): Promise<string | null> {
    return this.merchants.get(merchantKey(address, networkIndex))?.webhookUrl ?? null;
  }

  async setMerchantWebhookUrl(address: string, secretKey: string, url: string, networkIndex: NetworkIndex): Promise<boolean> {
    const key = merchantKey(address, networkIndex);
    const record = this.merchants.get(key);
    if (!record || record.secretKeyHash !== sha256(secretKey)) return false;
    record.webhookUrl = url || undefined;
    return true;
  }

  async getWebhookSigningKey(address: string, networkIndex: NetworkIndex): Promise<string | null> {
    return this.merchants.get(merchantKey(address, networkIndex))?.secretKeyHash || null;
  }

  async getMerchantProfile(address: string, networkIndex: NetworkIndex) {
    const record = this.merchants.get(merchantKey(address, networkIndex));
    return {
      displayName: record?.displayName?.trim() ? record.displayName : null,
      allowedIps: record?.allowedIps ?? [],
      logoDataUrl: record?.logoDataUrl ?? null,
    };
  }

  async setMerchantDisplayName(address: string, networkIndex: NetworkIndex, displayName: string): Promise<void> {
    this.ensureMerchant(address, networkIndex);
    const record = this.merchants.get(merchantKey(address, networkIndex))!;
    record.displayName = displayName.trim() || undefined;
  }

  async setMerchantAllowedIps(address: string, networkIndex: NetworkIndex, allowedIps: string[]): Promise<void> {
    this.ensureMerchant(address, networkIndex);
    const record = this.merchants.get(merchantKey(address, networkIndex))!;
    record.allowedIps = allowedIps;
  }

  async setMerchantLogo(address: string, networkIndex: NetworkIndex, logoDataUrl: string | null): Promise<void> {
    this.ensureMerchant(address, networkIndex);
    const record = this.merchants.get(merchantKey(address, networkIndex))!;
    record.logoDataUrl = logoDataUrl || undefined;
  }
}
