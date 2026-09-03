// Supabase (Postgres) Store implementation — the durable, real-deployment
// driver. Only instantiated when NOMOS_STORE_DRIVER=supabase; see index.ts.
// Schema: supabase/migrations/0001_init.sql onward.
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
  type CreatePaymentLinkInput,
  type CreatePayoutInput,
  type Deposit,
  type DepositStatus,
  InsufficientBalanceError,
  type LedgerEntry,
  type LedgerKind,
  type NetworkIndex,
  type PaymentLink,
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
  network_index: number;
  flow: "A" | "B";
  tx_hash: string;
  amount_wei: string;
  token: string;
  note: string | null;
  ref: string | null;
  reference: string;
  link_id: string | null;
  status: DepositStatus;
  shield_tx_hash: string | null;
  fee_wei: string | null;
  recorded_at: string;
};

type LedgerEntryRow = {
  id: string;
  merchant_address: string;
  network_index: number;
  direction: "credit" | "debit";
  amount_wei: string;
  token: string;
  kind: string;
  deposit_id: string | null;
  payout_id: string | null;
  running_balance_wei: string;
  created_at: string;
};

function depositFromRow(r: DepositRow): Deposit {
  return {
    id: r.id,
    merchantAddress: r.merchant_address,
    networkIndex: r.network_index,
    flow: r.flow,
    txHash: r.tx_hash,
    amountWei: BigInt(r.amount_wei),
    token: r.token,
    note: r.note ?? undefined,
    ref: r.ref ?? undefined,
    reference: r.reference,
    linkId: r.link_id ?? undefined,
    status: r.status,
    shieldTxHash: r.shield_tx_hash ?? undefined,
    feeWei: BigInt(r.fee_wei ?? "0"),
    recordedAt: Math.floor(new Date(r.recorded_at).getTime() / 1000),
  };
}

type PayoutRow = {
  id: string;
  merchant_address: string;
  network_index: number;
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
    networkIndex: r.network_index,
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

type PaymentLinkRow = {
  id: string;
  merchant_address: string;
  network_index: number;
  amount_wei: string | null;
  token: string;
  note: string | null;
  ref: string;
  expires_at: string | null;
  revoked: boolean;
  created_at: string;
  logo_data_url: string | null;
  single_use: boolean;
  callback_url: string | null;
};

function paymentLinkFromRow(r: PaymentLinkRow): PaymentLink {
  return {
    id: r.id,
    merchantAddress: r.merchant_address,
    networkIndex: r.network_index,
    amountWei: r.amount_wei !== null ? BigInt(r.amount_wei) : undefined,
    token: r.token,
    note: r.note ?? undefined,
    ref: r.ref,
    expiresAt: r.expires_at ? Math.floor(new Date(r.expires_at).getTime() / 1000) : undefined,
    revoked: r.revoked,
    createdAt: Math.floor(new Date(r.created_at).getTime() / 1000),
    logoDataUrl: r.logo_data_url ?? undefined,
    singleUse: r.single_use ?? false,
    callbackUrl: r.callback_url ?? undefined,
  };
}

function newReference(): string {
  return `nx_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function randomRef(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export class SupabaseStore implements Store {
  private client: SupabaseClient;

  constructor() {
    const url = requireEnv("SUPABASE_URL");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    this.client = createClient(url, serviceKey);
  }

  private async ensureMerchant(address: string, networkIndex: NetworkIndex) {
    const { error } = await this.client
      .from("merchants")
      .upsert(
        { address: address.toLowerCase(), network_index: networkIndex, public_key: "", secret_key_hash: "" },
        { onConflict: "address,network_index", ignoreDuplicates: true }
      );
    if (error) throw new Error(`ensureMerchant failed: ${error.message}`);
  }

  async recordDeposit(input: RecordDepositInput) {
    const { data: existing } = await this.client
      .from("deposits")
      .select("*")
      .eq("tx_hash", input.txHash)
      .maybeSingle<DepositRow>();
    if (existing) return { deposit: depositFromRow(existing), alreadyExisted: true };

    await this.ensureMerchant(input.merchantAddress, input.networkIndex);
    const { data, error } = await this.client
      .from("deposits")
      .insert({
        merchant_address: input.merchantAddress.toLowerCase(),
        network_index: input.networkIndex,
        flow: input.flow,
        tx_hash: input.txHash,
        amount_wei: input.amountWei.toString(),
        token: input.token ?? "STRK",
        note: input.note ?? null,
        ref: input.ref ?? null,
        reference: input.reference ?? newReference(),
        link_id: input.linkId ?? null,
        status: input.status ?? "pending_verify",
        fee_wei: (input.feeWei ?? 0n).toString(),
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

  // The unique index on (network_index, note_id) is what makes this atomic:
  // two concurrent callers both insert, and Postgres rejects the loser with
  // 23505. Application-level "check then insert" would race.
  async claimShieldedNote(noteId: string, networkIndex: NetworkIndex): Promise<boolean> {
    const { error } = await this.client
      .from("claimed_notes")
      .insert({ note_id: noteId, network_index: networkIndex });
    if (!error) return true;
    if (error.code === "23505") return false; // already claimed
    throw new Error(`claimShieldedNote failed: ${error.message}`);
  }

  async listClaimedNoteIds(networkIndex: NetworkIndex): Promise<Set<string>> {
    const { data, error } = await this.client
      .from("claimed_notes")
      .select("note_id")
      .eq("network_index", networkIndex);
    if (error) throw new Error(`listClaimedNoteIds failed: ${error.message}`);
    return new Set((data ?? []).map((r: { note_id: string }) => r.note_id));
  }

  async getDepositByReference(reference: string): Promise<Deposit | null> {
    const { data } = await this.client
      .from("deposits")
      .select("*")
      .eq("reference", reference)
      .maybeSingle<DepositRow>();
    return data ? depositFromRow(data) : null;
  }

  async listDepositsForLink(linkId: string): Promise<Deposit[]> {
    const { data } = await this.client
      .from("deposits")
      .select("*")
      .eq("link_id", linkId)
      .order("recorded_at", { ascending: false })
      .returns<DepositRow[]>();
    return (data ?? []).map(depositFromRow);
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

  async listDepositsFor(merchantAddress: string, networkIndex: NetworkIndex): Promise<Deposit[]> {
    const { data, error } = await this.client
      .from("deposits")
      .select("*")
      .eq("merchant_address", merchantAddress.toLowerCase())
      .eq("network_index", networkIndex)
      .order("recorded_at", { ascending: false })
      .returns<DepositRow[]>();
    if (error) throw new Error(`listDepositsFor failed: ${error.message}`);
    return (data ?? []).map(depositFromRow);
  }

  async getLedgerBalance(merchantAddress: string, token: string, networkIndex: NetworkIndex): Promise<bigint> {
    const { data } = await this.client
      .from("ledger_entries")
      .select("running_balance_wei")
      .eq("merchant_address", merchantAddress.toLowerCase())
      .eq("token", token)
      .eq("network_index", networkIndex)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ running_balance_wei: string }>();
    return data ? BigInt(data.running_balance_wei) : 0n;
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
    const balance = await this.getLedgerBalance(input.merchantAddress, input.token, input.networkIndex);
    const runningBalanceWei = balance + input.amountWei;
    const { data, error } = await this.client
      .from("ledger_entries")
      .insert({
        merchant_address: input.merchantAddress.toLowerCase(),
        network_index: input.networkIndex,
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
      networkIndex: input.networkIndex,
      direction: "credit",
      amountWei: input.amountWei,
      token: input.token,
      kind: input.kind,
      depositId: input.depositId,
      runningBalanceWei,
      createdAt: Math.floor(new Date(data.created_at).getTime() / 1000),
    };
  }

  // Delegated to a Postgres function so the balance check and the insert
  // happen under one lock. Doing it here — read, compare, insert — let two
  // concurrent payouts for the same merchant both pass the check against the
  // same balance and overdraw it.
  async debitLedger(input: {
    merchantAddress: string;
    networkIndex: NetworkIndex;
    amountWei: bigint;
    token: string;
    kind: LedgerKind;
    payoutId?: string;
  }): Promise<LedgerEntry> {
    const { data, error } = await this.client
      .rpc("debit_ledger", {
        p_merchant_address: input.merchantAddress.toLowerCase(),
        p_network_index: input.networkIndex,
        p_token: input.token,
        p_amount_wei: input.amountWei.toString(),
        p_kind: input.kind,
        p_payout_id: input.payoutId ?? null,
      })
      .single<LedgerEntryRow>();

    if (error) {
      // The function raises this when the balance won't cover the debit; the
      // caller expects the same typed error it always got.
      if (/insufficient balance/i.test(error.message)) {
        const have = /have (\d+)/.exec(error.message)?.[1];
        throw new InsufficientBalanceError(
          input.merchantAddress,
          input.amountWei,
          have !== undefined ? BigInt(have) : 0n,
        );
      }
      throw new Error(`debitLedger failed: ${error.message}`);
    }
    if (!data) throw new Error("debitLedger failed: no row returned.");

    return {
      id: data.id,
      merchantAddress: input.merchantAddress,
      networkIndex: input.networkIndex,
      direction: "debit",
      amountWei: BigInt(data.amount_wei),
      token: data.token,
      kind: data.kind as LedgerKind,
      payoutId: data.payout_id ?? undefined,
      runningBalanceWei: BigInt(data.running_balance_wei),
      createdAt: Math.floor(new Date(data.created_at).getTime() / 1000),
    };
  }

  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    await this.ensureMerchant(input.merchantAddress, input.networkIndex);
    const { data, error } = await this.client
      .from("payouts")
      .insert({
        merchant_address: input.merchantAddress.toLowerCase(),
        network_index: input.networkIndex,
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

  async listPayoutsFor(merchantAddress: string, networkIndex: NetworkIndex): Promise<Payout[]> {
    const { data, error } = await this.client
      .from("payouts")
      .select("*")
      .eq("merchant_address", merchantAddress.toLowerCase())
      .eq("network_index", networkIndex)
      .order("created_at", { ascending: false })
      .returns<PayoutRow[]>();
    if (error) throw new Error(`listPayoutsFor failed: ${error.message}`);
    return (data ?? []).map(payoutFromRow);
  }

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLink> {
    await this.ensureMerchant(input.merchantAddress, input.networkIndex);
    const { data, error } = await this.client
      .from("payment_links")
      .insert({
        merchant_address: input.merchantAddress.toLowerCase(),
        network_index: input.networkIndex,
        amount_wei: input.amountWei !== undefined ? input.amountWei.toString() : null,
        token: input.token,
        note: input.note ?? null,
        ref: input.ref ?? randomRef(),
        expires_at: input.expiresAt ? new Date(input.expiresAt * 1000).toISOString() : null,
        logo_data_url: input.logoDataUrl ?? null,
        single_use: input.singleUse ?? false,
        callback_url: input.callbackUrl ?? null,
      })
      .select("*")
      .single<PaymentLinkRow>();
    if (error || !data) throw new Error(`createPaymentLink failed: ${error?.message}`);
    return paymentLinkFromRow(data);
  }

  async getPaymentLink(id: string): Promise<PaymentLink | null> {
    const { data } = await this.client
      .from("payment_links")
      .select("*")
      .eq("id", id)
      .maybeSingle<PaymentLinkRow>();
    return data ? paymentLinkFromRow(data) : null;
  }

  async listPaymentLinksFor(merchantAddress: string, networkIndex: NetworkIndex): Promise<PaymentLink[]> {
    const { data, error } = await this.client
      .from("payment_links")
      .select("*")
      .eq("merchant_address", merchantAddress.toLowerCase())
      .eq("network_index", networkIndex)
      .order("created_at", { ascending: false })
      .returns<PaymentLinkRow[]>();
    if (error) throw new Error(`listPaymentLinksFor failed: ${error.message}`);
    return (data ?? []).map(paymentLinkFromRow);
  }

  async revokePaymentLink(id: string, merchantAddress: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("payment_links")
      .update({ revoked: true })
      .eq("id", id)
      .eq("merchant_address", merchantAddress.toLowerCase())
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`revokePaymentLink failed: ${error.message}`);
    return !!data;
  }

  async issueMerchantKey(address: string, networkIndex: NetworkIndex): Promise<{ publicKey: string; secretKey: string }> {
    const crypto = await import("crypto");
    const key = address.toLowerCase();
    const publicKey = `pk_${crypto.randomBytes(18).toString("hex")}`;
    const secretKey = `sk_${crypto.randomBytes(18).toString("hex")}`;
    const secretKeyHash = crypto.createHash("sha256").update(secretKey).digest("hex");
    const { error } = await this.client
      .from("merchants")
      .upsert(
        { address: key, network_index: networkIndex, public_key: publicKey, secret_key_hash: secretKeyHash },
        { onConflict: "address,network_index" }
      );
    if (error) throw new Error(`issueMerchantKey failed: ${error.message}`);
    return { publicKey, secretKey };
  }

  async getMerchantPublicKey(address: string, networkIndex: NetworkIndex): Promise<string | null> {
    const { data } = await this.client
      .from("merchants")
      .select("public_key")
      .eq("address", address.toLowerCase())
      .eq("network_index", networkIndex)
      .maybeSingle<{ public_key: string }>();
    return data?.public_key || null;
  }

  async verifyMerchantSecret(address: string, secretKey: string, networkIndex: NetworkIndex): Promise<boolean> {
    const crypto = await import("crypto");
    const { data } = await this.client
      .from("merchants")
      .select("secret_key_hash")
      .eq("address", address.toLowerCase())
      .eq("network_index", networkIndex)
      .maybeSingle<{ secret_key_hash: string }>();
    if (!data?.secret_key_hash) return false;
    return data.secret_key_hash === crypto.createHash("sha256").update(secretKey).digest("hex");
  }

  async getMerchantWebhookUrl(address: string, networkIndex: NetworkIndex): Promise<string | null> {
    const { data } = await this.client
      .from("merchants")
      .select("webhook_url")
      .eq("address", address.toLowerCase())
      .eq("network_index", networkIndex)
      .maybeSingle<{ webhook_url: string | null }>();
    return data?.webhook_url ?? null;
  }

  async setMerchantWebhookUrl(address: string, secretKey: string, url: string, networkIndex: NetworkIndex): Promise<boolean> {
    const ok = await this.verifyMerchantSecret(address, secretKey, networkIndex);
    if (!ok) return false;
    const { error } = await this.client
      .from("merchants")
      .update({ webhook_url: url || null })
      .eq("address", address.toLowerCase())
      .eq("network_index", networkIndex);
    return !error;
  }

  async getWebhookSigningKey(address: string, networkIndex: NetworkIndex): Promise<string | null> {
    const { data } = await this.client
      .from("merchants")
      .select("secret_key_hash")
      .eq("address", address.toLowerCase())
      .eq("network_index", networkIndex)
      .maybeSingle<{ secret_key_hash: string }>();
    return data?.secret_key_hash || null;
  }

  async getMerchantProfile(address: string, networkIndex: NetworkIndex) {
    const { data } = await this.client
      .from("merchants")
      .select("display_name, allowed_ips, logo_data_url")
      .eq("address", address.toLowerCase())
      .eq("network_index", networkIndex)
      .maybeSingle<{ display_name: string | null; allowed_ips: string[] | null; logo_data_url: string | null }>();
    return {
      displayName: data?.display_name?.trim() ? data.display_name : null,
      allowedIps: data?.allowed_ips ?? [],
      logoDataUrl: data?.logo_data_url ?? null,
    };
  }

  async setMerchantDisplayName(address: string, networkIndex: NetworkIndex, displayName: string): Promise<void> {
    await this.ensureMerchant(address, networkIndex);
    const { error } = await this.client
      .from("merchants")
      .update({ display_name: displayName.trim() || null })
      .eq("address", address.toLowerCase())
      .eq("network_index", networkIndex);
    if (error) throw new Error(`setMerchantDisplayName failed: ${error.message}`);
  }

  async setMerchantAllowedIps(address: string, networkIndex: NetworkIndex, allowedIps: string[]): Promise<void> {
    await this.ensureMerchant(address, networkIndex);
    const { error } = await this.client
      .from("merchants")
      .update({ allowed_ips: allowedIps })
      .eq("address", address.toLowerCase())
      .eq("network_index", networkIndex);
    if (error) throw new Error(`setMerchantAllowedIps failed: ${error.message}`);
  }

  async setMerchantLogo(address: string, networkIndex: NetworkIndex, logoDataUrl: string | null): Promise<void> {
    await this.ensureMerchant(address, networkIndex);
    const { error } = await this.client
      .from("merchants")
      .update({ logo_data_url: logoDataUrl })
      .eq("address", address.toLowerCase())
      .eq("network_index", networkIndex);
    if (error) throw new Error(`setMerchantLogo failed: ${error.message}`);
  }
}
