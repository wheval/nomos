// The Store abstraction behind Nomos's custodial ledger. All amounts are
// wei bigints — never floats, this is money. Three implementations share
// this interface (memoryStore for tests/CI, fileStore for local dev,
// supabaseStore for anything real); see index.ts for driver selection.

export type Flow = "A" | "B";

export type DepositStatus =
  | "pending_verify"
  | "verified"
  | "pending_shield"
  | "shielded"
  | "shield_failed"
  | "rejected";

export type Deposit = {
  id: string;
  merchantAddress: string;
  flow: Flow;
  txHash: string;
  amountWei: bigint;
  token: string;
  note?: string;
  ref?: string;
  status: DepositStatus;
  shieldTxHash?: string;
  recordedAt: number; // unix seconds
};

export type RecordDepositInput = {
  merchantAddress: string;
  flow: Flow;
  txHash: string;
  amountWei: bigint;
  token?: string;
  note?: string;
  ref?: string;
  status?: DepositStatus;
};

export type LedgerKind = "flow_a_deposit" | "flow_b_deposit" | "payout";
export type LedgerDirection = "credit" | "debit";

export type LedgerEntry = {
  id: string;
  merchantAddress: string;
  direction: LedgerDirection;
  amountWei: bigint;
  token: string;
  kind: LedgerKind;
  depositId?: string;
  payoutId?: string;
  runningBalanceWei: bigint;
  createdAt: number;
};

export type PayoutMode = "withdraw" | "transfer";
export type PayoutStatus = "pending" | "broadcasting" | "confirmed" | "failed";

export type Payout = {
  id: string;
  merchantAddress: string;
  destination: string;
  amountWei: bigint;
  token: string;
  mode: PayoutMode;
  status: PayoutStatus;
  txHash?: string;
  createdAt: number;
  completedAt?: number;
};

export type CreatePayoutInput = {
  merchantAddress: string;
  destination: string;
  amountWei: bigint;
  token: string;
  mode: PayoutMode;
};

export type MerchantKey = {
  publicKey: string;
  secretKeyHash: string; // sha256 hex — the plaintext secret is never stored
  createdAt: number;
  webhookUrl?: string;
};

export class InsufficientBalanceError extends Error {
  constructor(merchantAddress: string, requestedWei: bigint, balanceWei: bigint) {
    super(
      `Insufficient balance for ${merchantAddress}: requested ${requestedWei}, has ${balanceWei}`
    );
    this.name = "InsufficientBalanceError";
  }
}

export interface Store {
  // Deposits
  recordDeposit(input: RecordDepositInput): Promise<{ deposit: Deposit; alreadyExisted: boolean }>;
  getDepositByTxHash(txHash: string): Promise<Deposit | null>;
  markDepositShielded(depositId: string, shieldTxHash: string): Promise<void>;
  markDepositShieldFailed(depositId: string): Promise<void>;
  listPendingShieldDeposits(): Promise<Deposit[]>;
  listDepositsFor(merchantAddress: string): Promise<Deposit[]>;

  // Ledger — every balance is scoped to a single token. STRK and USDC are
  // different assets with different decimals; summing their wei together
  // would be meaningless, so there is no cross-token balance.
  creditLedger(input: {
    merchantAddress: string;
    amountWei: bigint;
    token: string;
    kind: LedgerKind;
    depositId?: string;
  }): Promise<LedgerEntry>;
  debitLedger(input: {
    merchantAddress: string;
    amountWei: bigint;
    token: string;
    kind: LedgerKind;
    payoutId?: string;
  }): Promise<LedgerEntry>; // throws InsufficientBalanceError
  getLedgerBalance(merchantAddress: string, token: string): Promise<bigint>;

  // Payouts
  createPayout(input: CreatePayoutInput): Promise<Payout>;
  updatePayoutStatus(payoutId: string, status: PayoutStatus, txHash?: string): Promise<void>;
  listPayoutsFor(merchantAddress: string): Promise<Payout[]>;

  // Merchants / API keys / webhooks — surface unchanged from the pre-ledger store.
  issueMerchantKey(address: string): Promise<{ publicKey: string; secretKey: string }>;
  getMerchantPublicKey(address: string): Promise<string | null>;
  verifyMerchantSecret(address: string, secretKey: string): Promise<boolean>;
  getMerchantWebhookUrl(address: string): Promise<string | null>;
  setMerchantWebhookUrl(address: string, secretKey: string, url: string): Promise<boolean>;
  getWebhookSigningKey(address: string): Promise<string | null>;
}
