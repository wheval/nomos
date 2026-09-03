// The Store abstraction behind Nomos's custodial ledger. All amounts are
// wei bigints — never floats, this is money. Three implementations share
// this interface (memoryStore for tests/CI, fileStore for local dev,
// supabaseStore for anything real); see index.ts for driver selection.

// Frontend provider index, same convention as constants.ts's myFrontendProviders
// (0 = Mainnet/"live", 2 = Sepolia/"test"). Every merchant-owned record below
// is scoped by this - test and live never share a row, the same way a real
// payment gateway's test/live API keys never see each other's data.
export type NetworkIndex = number;

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
  networkIndex: NetworkIndex;
  flow: Flow;
  txHash: string;
  amountWei: bigint;
  token: string;
  note?: string;
  ref?: string;
  // Unique per payment, unlike `ref` which is the Payment Link's own and is
  // therefore shared by every payment made through it. This is what lets two
  // people paying the same link be told apart, and what a merchant passes to
  // the verify endpoint. Merchant-supplied when given, generated otherwise.
  reference: string;
  linkId?: string;
  status: DepositStatus;
  shieldTxHash?: string;
  // Nomos's flat fee on this payment, in the token's smallest unit. Stored
  // per deposit rather than derived, so a later change to the fee schedule
  // never rewrites the history of what a merchant was actually charged.
  // amountWei stays gross; the ledger is credited amountWei - feeWei.
  feeWei: bigint;
  recordedAt: number; // unix seconds
};

export type RecordDepositInput = {
  merchantAddress: string;
  networkIndex: NetworkIndex;
  flow: Flow;
  txHash: string;
  amountWei: bigint;
  token?: string;
  note?: string;
  ref?: string;
  reference?: string; // generated when absent
  linkId?: string;
  status?: DepositStatus;
  feeWei?: bigint;
};

export type LedgerKind = "flow_a_deposit" | "flow_b_deposit" | "payout" | "payout_fee";
export type LedgerDirection = "credit" | "debit";

export type LedgerEntry = {
  id: string;
  merchantAddress: string;
  networkIndex: NetworkIndex;
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
  networkIndex: NetworkIndex;
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
  networkIndex: NetworkIndex;
  destination: string;
  amountWei: bigint;
  token: string;
  mode: PayoutMode;
};

// A persisted Payment Link. Before this, everything a customer saw (the
// recipient address, amount, token) was raw URL query params with no
// server-side source of truth - anyone could edit a copied link before
// sharing it, silently redirecting the payment to a different address or
// amount. Persisting it means the checkout page fetches the canonical
// record by id instead of trusting whatever's in the URL.
export type PaymentLink = {
  id: string;
  merchantAddress: string;
  networkIndex: NetworkIndex;
  amountWei?: bigint; // absent = open amount, customer enters their own
  token: string;
  note?: string;
  ref: string;
  expiresAt?: number; // unix seconds
  revoked: boolean;
  createdAt: number;
  logoDataUrl?: string; // optional branding image shown on checkout
  // An invoice: payable exactly once. A reusable page (the default) takes any
  // number of payments; an invoice closes as soon as one is recorded, and
  // checkout tells the next visitor it has already been paid.
  singleUse: boolean;
  // Where to send the payer once they're done, like Paystack's callback_url.
  callbackUrl?: string;
};

export type CreatePaymentLinkInput = {
  merchantAddress: string;
  networkIndex: NetworkIndex;
  amountWei?: bigint;
  token: string;
  note?: string;
  ref?: string; // auto-generated if absent
  expiresAt?: number;
  logoDataUrl?: string;
  singleUse?: boolean;
  callbackUrl?: string;
};

// One MerchantKey per (address, networkIndex) — a merchant's test and live
// API keys are entirely separate credentials, same as Paystack/Stripe: a
// test secret key can never authenticate a live-mode request or vice versa.
export type MerchantKey = {
  publicKey: string;
  secretKeyHash: string; // sha256 hex — the plaintext secret is never stored
  createdAt: number;
  webhookUrl?: string;
  displayName?: string;
  allowedIps?: string[]; // empty/absent = allow every IP
  logoDataUrl?: string;
};

export type MerchantProfile = {
  displayName: string | null;
  allowedIps: string[];
  logoDataUrl: string | null;
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
  // Claim a shielded note for a deposit, exactly once, ever.
  //
  // Flow A cannot be verified from public calldata, so settlement rests on
  // matching an incoming note in the operating wallet. That wallet is shared
  // custody for every merchant, so without a claim record the same note
  // satisfies the check repeatedly and the ledger can be credited for money
  // nobody paid. Returns false when the note is already spoken for; the
  // caller must then refuse the deposit. Implementations MUST make this
  // atomic — two concurrent callers cannot both win the same note.
  claimShieldedNote(noteId: string, networkIndex: NetworkIndex): Promise<boolean>;
  // Which notes are already spoken for, so reconciliation can tell an
  // unattributed payment from one that simply has no note.
  listClaimedNoteIds(networkIndex: NetworkIndex): Promise<Set<string>>;
  // Backs the verify endpoint, and the "has this invoice been paid?" check.
  getDepositByReference(reference: string): Promise<Deposit | null>;
  listDepositsForLink(linkId: string): Promise<Deposit[]>;
  markDepositShielded(depositId: string, shieldTxHash: string): Promise<void>;
  markDepositShieldFailed(depositId: string): Promise<void>;
  listPendingShieldDeposits(): Promise<Deposit[]>;
  listDepositsFor(merchantAddress: string, networkIndex: NetworkIndex): Promise<Deposit[]>;

  // Ledger — every balance is scoped to a single token AND network. STRK and
  // USDC are different assets with different decimals (no cross-token
  // balance); test (Sepolia) and live (Mainnet) are different money
  // entirely (no cross-network balance either).
  creditLedger(input: {
    merchantAddress: string;
    networkIndex: NetworkIndex;
    amountWei: bigint;
    token: string;
    kind: LedgerKind;
    depositId?: string;
  }): Promise<LedgerEntry>;
  debitLedger(input: {
    merchantAddress: string;
    networkIndex: NetworkIndex;
    amountWei: bigint;
    token: string;
    kind: LedgerKind;
    payoutId?: string;
  }): Promise<LedgerEntry>; // throws InsufficientBalanceError
  getLedgerBalance(merchantAddress: string, token: string, networkIndex: NetworkIndex): Promise<bigint>;

  // Payouts
  createPayout(input: CreatePayoutInput): Promise<Payout>;
  updatePayoutStatus(payoutId: string, status: PayoutStatus, txHash?: string): Promise<void>;
  listPayoutsFor(merchantAddress: string, networkIndex: NetworkIndex): Promise<Payout[]>;

  // Payment Links
  createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLink>;
  getPaymentLink(id: string): Promise<PaymentLink | null>;
  listPaymentLinksFor(merchantAddress: string, networkIndex: NetworkIndex): Promise<PaymentLink[]>;
  revokePaymentLink(id: string, merchantAddress: string): Promise<boolean>;

  // Merchants / API keys / webhooks — one key pair + webhook URL per
  // (address, networkIndex). See MerchantKey's comment: test and live keys
  // are entirely separate credentials.
  issueMerchantKey(address: string, networkIndex: NetworkIndex): Promise<{ publicKey: string; secretKey: string }>;
  getMerchantPublicKey(address: string, networkIndex: NetworkIndex): Promise<string | null>;
  verifyMerchantSecret(address: string, secretKey: string, networkIndex: NetworkIndex): Promise<boolean>;
  getMerchantWebhookUrl(address: string, networkIndex: NetworkIndex): Promise<string | null>;
  setMerchantWebhookUrl(address: string, secretKey: string, url: string, networkIndex: NetworkIndex): Promise<boolean>;
  getWebhookSigningKey(address: string, networkIndex: NetworkIndex): Promise<string | null>;
  getMerchantProfile(address: string, networkIndex: NetworkIndex): Promise<MerchantProfile>;
  setMerchantDisplayName(address: string, networkIndex: NetworkIndex, displayName: string): Promise<void>;
  setMerchantAllowedIps(address: string, networkIndex: NetworkIndex, allowedIps: string[]): Promise<void>;
  setMerchantLogo(address: string, networkIndex: NetworkIndex, logoDataUrl: string | null): Promise<void>;
}
