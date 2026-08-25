// Supabase (Postgres) Store implementation — the durable, real-deployment
// driver. Only instantiated when NOMOS_STORE_DRIVER=supabase; see index.ts.
// Schema: supabase/migrations/0001_init.sql.
//
// Note on concurrency: creditLedger/debitLedger read the current balance
// then insert a new entry, same read-then-write shape as the file/memory
// stores — not wrapped in a serializable transaction or a DB-side
// balance-check function. Fine at hackathon-demo volume (one operating
// wallet, low request concurrency); a real deployment handling concurrent
// payouts for the same merchant would want that debit check enforced
// inside a Postgres function instead of round-tripped through the client.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  type CreatePayoutInput,
  type Deposit,
  type DepositStatus,
  InsufficientBalanceError,
  type LedgerEntry,
  type LedgerKind,
  type Payout,
  type PayoutStatus,
  type RecordDepositInput,
  type Store,
} from "./types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required for NOMOS_STORE_DRIVER=supabase. Set it in .env.local once the Supabase project exists.`
    );
  }
  return value;
}

type DepositRow = {
  id: string;
  merchant_address: string;
  flow: "A" | "B";
  tx_hash: string;
  amount_wei: string;
  token: string;
  note: string | null;
  ref: string | null;
  status: DepositStatus;
  shield_tx_hash: string | null;
  recorded_at: string;
};

function depositFromRow(r: DepositRow): Deposit {
  return {
    id: r.id,
    merchantAddress: r.merchant_address,
    flow: r.flow,
    txHash: r.tx_hash,
    amountWei: BigInt(r.amount_wei),
    token: r.token,
    note: r.note ?? undefined,
    ref: r.ref ?? undefined,
    status: r.status,
    shieldTxHash: r.shield_tx_hash ?? undefined,
    recordedAt: Math.floor(new Date(r.recorded_at).getTime() / 1000),
  };
}

type PayoutRow = {
  id: string;
  merchant_address: string;
  destination: string;
  amount_wei: string;
  token: string;
  mode: "withdraw" | "transfer";
  status: PayoutStatus;
  tx_hash: string | null;
  created_at: string;
  completed_at: string | null;
};

function payoutFromRow(r: PayoutRow): Payout {
  return {
    id: r.id,
    merchantAddress: r.merchant_address,
    destination: r.destination,
    amountWei: BigInt(r.amount_wei),
    token: r.token,
    mode: r.mode,
    status: r.status,
    txHash: r.tx_hash ?? undefined,
    createdAt: Math.floor(new Date(r.created_at).getTime() / 1000),
    completedAt: r.completed_at ? Math.floor(new Date(r.completed_at).getTime() / 1000) : undefined,
  };
}

export class SupabaseStore implements Store {
  private client: SupabaseClient;

  constructor() {
    const url = requireEnv("SUPABASE_URL");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    this.client = createClient(url, serviceKey);
  }

  private async ensureMerchant(address: string) {
    const key = address.toLowerCase();
    const { error } = await this.client
      .from("merchants")
      .upsert({ address: key, public_key: "", secret_key_hash: "" }, { onConflict: "address", ignoreDuplicates: true });
    if (error) throw new Error(`ensureMerchant failed: ${error.message}`);
  }

  async recordDeposit(input: RecordDepositInput) {
    const { data: existing } = await this.client
      .from("deposits")
      .select("*")
      .eq("tx_hash", input.txHash)
      .maybeSingle<DepositRow>();
    if (existing) return { deposit: depositFromRow(existing), alreadyExisted: true };

    await this.ensureMerchant(input.merchantAddress);
    const { data, error } = await this.client
      .from("deposits")
      .insert({
        merchant_address: input.merchantAddress.toLowerCase(),
        flow: input.flow,
        tx_hash: input.txHash,
        amount_wei: input.amountWei.toString(),
        token: input.token ?? "STRK",
        note: input.note ?? null,
        ref: input.ref ?? null,
        status: input.status ?? "pending_verify",
      })
      .select("*")
      .single<DepositRow>();
    if (error || !data) throw new Error(`recordDeposit failed: ${error?.message}`);
    return { deposit: depositFromRow(data), alreadyExisted: false };
  }

  async getDepositByTxHash(txHash: string): Promise<Deposit | null> {
    const { data } = await this.client.from("deposits").select("*").eq("tx_hash", txHash).maybeSingle<DepositRow>();
    return data ? depositFromRow(data) : null;
  }

  async markDepositShielded(depositId: string, shieldTxHash: string): Promise<void> {
    const { error } = await this.client
      .from("deposits")
      .update({ status: "shielded", shield_tx_hash: shieldTxHash })
      .eq("id", depositId);
    if (error) throw new Error(`markDepositShielded failed: ${error.message}`);
  }

  async markDepositShieldFailed(depositId: string): Promise<void> {
    const { error } = await this.client.from("deposits").update({ status: "shield_failed" }).eq("id", depositId);
    if (error) throw new Error(`markDepositShieldFailed failed: ${error.message}`);
  }

  async listPendingShieldDeposits(): Promise<Deposit[]> {
    const { data, error } = await this.client.from("deposits").select("*").eq("status", "pending_shield").returns<DepositRow[]>();
    if (error) throw new Error(`listPendingShieldDeposits failed: ${error.message}`);
    return (data ?? []).map(depositFromRow);
  }

  async listDepositsFor(merchantAddress: string): Promise<Deposit[]> {
    const { data, error } = await this.client
      .from("deposits")
      .select("*")
      .eq("merchant_address", merchantAddress.toLowerCase())
      .order("recorded_at", { ascending: false })
      .returns<DepositRow[]>();
    if (error) throw new Error(`listDepositsFor failed: ${error.message}`);
    return (data ?? []).map(depositFromRow);
  }

  async getLedgerBalance(merchantAddress: string, token: string): Promise<bigint> {
    const { data } = await this.client
      .from("ledger_entries")
      .select("running_balance_wei")
      .eq("merchant_address", merchantAddress.toLowerCase())
      .eq("token", token)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ running_balance_wei: string }>();
    return data ? BigInt(data.running_balance_wei) : 0n;
  }

  async creditLedger(input: { merchantAddress: string; amountWei: bigint; token: string; kind: LedgerKind; depositId?: string }): Promise<LedgerEntry> {
    await this.ensureMerchant(input.merchantAddress);
    const balance = await this.getLedgerBalance(input.merchantAddress, input.token);
    const runningBalanceWei = balance + input.amountWei;
    const { data, error } = await this.client
      .from("ledger_entries")
      .insert({
        merchant_address: input.merchantAddress.toLowerCase(),
        direction: "credit",
        amount_wei: input.amountWei.toString(),
        token: input.token,
        kind: input.kind,
        deposit_id: input.depositId ?? null,
        running_balance_wei: runningBalanceWei.toString(),
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(`creditLedger failed: ${error?.message}`);
    return {
      id: data.id,
      merchantAddress: input.merchantAddress,
      direction: "credit",
      amountWei: input.amountWei,
      token: input.token,
      kind: input.kind,
      depositId: input.depositId,
      runningBalanceWei,
      createdAt: Math.floor(new Date(data.created_at).getTime() / 1000),
    };
  }

  async debitLedger(input: { merchantAddress: string; amountWei: bigint; token: string; kind: LedgerKind; payoutId?: string }): Promise<LedgerEntry> {
    const balance = await this.getLedgerBalance(input.merchantAddress, input.token);
    if (balance < input.amountWei) {
      throw new InsufficientBalanceError(input.merchantAddress, input.amountWei, balance);
    }
    const runningBalanceWei = balance - input.amountWei;
    const { data, error } = await this.client
      .from("ledger_entries")
      .insert({
        merchant_address: input.merchantAddress.toLowerCase(),
        direction: "debit",
        amount_wei: input.amountWei.toString(),
        token: input.token,
        kind: input.kind,
        payout_id: input.payoutId ?? null,
        running_balance_wei: runningBalanceWei.toString(),
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(`debitLedger failed: ${error?.message}`);
    return {
      id: data.id,
      merchantAddress: input.merchantAddress,
      direction: "debit",
      amountWei: input.amountWei,
      token: input.token,
      kind: input.kind,
      payoutId: input.payoutId,
      runningBalanceWei,
      createdAt: Math.floor(new Date(data.created_at).getTime() / 1000),
    };
  }

  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    await this.ensureMerchant(input.merchantAddress);
    const { data, error } = await this.client
      .from("payouts")
      .insert({
        merchant_address: input.merchantAddress.toLowerCase(),
        destination: input.destination,
        amount_wei: input.amountWei.toString(),
        token: input.token,
        mode: input.mode,
        status: "pending",
      })
      .select("*")
      .single<PayoutRow>();
    if (error || !data) throw new Error(`createPayout failed: ${error?.message}`);
    return payoutFromRow(data);
  }

  async updatePayoutStatus(payoutId: string, status: PayoutStatus, txHash?: string): Promise<void> {
    const update: Record<string, unknown> = { status };
    if (txHash) update.tx_hash = txHash;
    if (status === "confirmed" || status === "failed") update.completed_at = new Date().toISOString();
    const { error } = await this.client.from("payouts").update(update).eq("id", payoutId);
    if (error) throw new Error(`updatePayoutStatus failed: ${error.message}`);
  }

  async listPayoutsFor(merchantAddress: string): Promise<Payout[]> {
    const { data, error } = await this.client
      .from("payouts")
      .select("*")
      .eq("merchant_address", merchantAddress.toLowerCase())
      .order("created_at", { ascending: false })
      .returns<PayoutRow[]>();
    if (error) throw new Error(`listPayoutsFor failed: ${error.message}`);
    return (data ?? []).map(payoutFromRow);
  }

  async issueMerchantKey(address: string): Promise<{ publicKey: string; secretKey: string }> {
    const crypto = await import("crypto");
    const key = address.toLowerCase();
    const publicKey = `pk_${crypto.randomBytes(18).toString("hex")}`;
    const secretKey = `sk_${crypto.randomBytes(18).toString("hex")}`;
    const secretKeyHash = crypto.createHash("sha256").update(secretKey).digest("hex");
    const { error } = await this.client
      .from("merchants")
      .upsert({ address: key, public_key: publicKey, secret_key_hash: secretKeyHash }, { onConflict: "address" });
    if (error) throw new Error(`issueMerchantKey failed: ${error.message}`);
    return { publicKey, secretKey };
  }

  async getMerchantPublicKey(address: string): Promise<string | null> {
    const { data } = await this.client
      .from("merchants")
      .select("public_key")
      .eq("address", address.toLowerCase())
      .maybeSingle<{ public_key: string }>();
    return data?.public_key || null;
  }

  async verifyMerchantSecret(address: string, secretKey: string): Promise<boolean> {
    const crypto = await import("crypto");
    const { data } = await this.client
      .from("merchants")
      .select("secret_key_hash")
      .eq("address", address.toLowerCase())
      .maybeSingle<{ secret_key_hash: string }>();
    if (!data?.secret_key_hash) return false;
    return data.secret_key_hash === crypto.createHash("sha256").update(secretKey).digest("hex");
  }

  async getMerchantWebhookUrl(address: string): Promise<string | null> {
    const { data } = await this.client
      .from("merchants")
      .select("webhook_url")
      .eq("address", address.toLowerCase())
      .maybeSingle<{ webhook_url: string | null }>();
    return data?.webhook_url ?? null;
  }

  async setMerchantWebhookUrl(address: string, secretKey: string, url: string): Promise<boolean> {
    const ok = await this.verifyMerchantSecret(address, secretKey);
    if (!ok) return false;
    const { error } = await this.client
      .from("merchants")
      .update({ webhook_url: url || null })
      .eq("address", address.toLowerCase());
    return !error;
  }

  async getWebhookSigningKey(address: string): Promise<string | null> {
    const { data } = await this.client
      .from("merchants")
      .select("secret_key_hash")
      .eq("address", address.toLowerCase())
      .maybeSingle<{ secret_key_hash: string }>();
    return data?.secret_key_hash || null;
  }
}
