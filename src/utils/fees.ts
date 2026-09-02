// Nomos's pricing. Flat per transaction, never a percentage.
//
// The protocol underneath is flat — STRK20 charges one pool fee per action
// regardless of size, which is the whole reason a $100k private payment is
// viable here and costs 0.25% on Railgun. Charging a percentage on top would
// hand that advantage straight back, and would invite the largest merchants
// to skip Nomos and drive the pool themselves. So the fee is a fixed amount
// per transaction, quoted in the token being paid.
//
// Costs this has to cover, all denominated in STRK no matter which token is
// being moved (see poolFeeAmount in server/signer/privacyClient.ts):
//
//   payout    ~6 STRK pool fee + ~3.5 STRK gas  ≈ 9.5 STRK
//   shielding ~the same again, for Flow B only
//
// Both are per *operation*, not per payment, so margin comes from batching:
// one payout settles many transactions. That is why minimumPayoutWei exists
// — without it a merchant could withdraw per payment and each settlement
// would cost more than the transaction earned.
import { Tokens, type TokenSymbol } from "./constants";

export type Flow = "A" | "B";

// Fixed amounts in each token's own smallest unit. Quoted per token rather
// than converted from USD at runtime: a price oracle in the settlement path
// is a failure mode, and these are cents — precision is not the point.
//
// STRK amounts assume roughly $0.026/STRK and are deliberately round. They
// want revisiting if STRK moves by an order of magnitude; USDC never does.
type FeeSchedule = {
  /** Flow A — the payer already paid the pool fee themselves. */
  transactionA: bigint;
  /** Flow B — Nomos must also shield the deposit, so roughly double. */
  transactionB: bigint;
  /** Charged per payout, covering the settlement it actually triggers. */
  payout: bigint;
  /** Below this a flat fee is an absurd share of the payment. */
  minimumPayment: bigint;
  /** Forces payouts to batch, which is what makes the payout fee work. */
  minimumPayout: bigint;
};

const SCHEDULES: Record<TokenSymbol, FeeSchedule> = {
  // 6 decimals — 1_000_000 = $1.
  USDC: {
    transactionA: 100_000n, //  $0.10
    transactionB: 200_000n, //  $0.20
    payout: 300_000n, //        $0.30
    minimumPayment: 1_000_000n, //   $1
    minimumPayout: 5_000_000n, //    $5
  },
  // 18 decimals. ~$0.026/STRK at time of writing.
  STRK: {
    transactionA: 4_000_000_000_000_000_000n, //    4 STRK  ≈ $0.10
    transactionB: 8_000_000_000_000_000_000n, //    8 STRK  ≈ $0.21
    payout: 12_000_000_000_000_000_000n, //        12 STRK  ≈ $0.31
    minimumPayment: 40_000_000_000_000_000_000n, // 40 STRK ≈ $1.04
    minimumPayout: 200_000_000_000_000_000_000n, // 200 STRK ≈ $5.22
  },
};

function scheduleFor(token: string): FeeSchedule | null {
  return (SCHEDULES as Record<string, FeeSchedule | undefined>)[token] ?? null;
}

/** True when we have a published price for this token. */
export function isPricedToken(token: string): token is TokenSymbol {
  return scheduleFor(token) !== null;
}

/**
 * Fee for one payment, in the token's smallest unit.
 *
 * An unpriced token yields 0 rather than throwing. This runs after the money
 * has already moved on-chain — refusing to price a settled payment would
 * strand the merchant's funds, which is far worse than forgoing a fee we
 * failed to configure. Link creation rejects unpriced tokens up front.
 */
export function transactionFeeWei(token: string, flow: Flow): bigint {
  const schedule = scheduleFor(token);
  if (!schedule) return 0n;
  return flow === "A" ? schedule.transactionA : schedule.transactionB;
}

/** Fee deducted from a payout, covering the settlement it triggers. */
export function payoutFeeWei(token: string): bigint {
  return scheduleFor(token)?.payout ?? 0n;
}

/** Smallest payment worth accepting for this token. */
export function minimumPaymentWei(token: string): bigint {
  return scheduleFor(token)?.minimumPayment ?? 0n;
}

/** Smallest payout worth settling for this token. */
export function minimumPayoutWei(token: string): bigint {
  return scheduleFor(token)?.minimumPayout ?? 0n;
}

/**
 * What the merchant is credited: gross less fee, never below zero.
 *
 * The clamp matters. minimumPaymentWei should stop a payment smaller than
 * its own fee from being accepted, but that check lives at link creation and
 * a payer can always send an arbitrary amount directly — so settlement has
 * to stay safe on its own. Crediting a negative would corrupt the ledger.
 */
export function netAfterFee(grossWei: bigint, feeWei: bigint | undefined): bigint {
  // feeWei is optional because deposits recorded before fees existed carry
  // none, and a missing fee must mean "credit in full" rather than throw on
  // money that has already moved.
  const net = grossWei - (feeWei ?? 0n);
  return net > 0n ? net : 0n;
}

/** Human-readable fee, for checkout copy and the pricing docs. */
export function formatFee(token: string, wei: bigint): string {
  const decimals = Tokens[token as TokenSymbol]?.decimals ?? 18;
  const whole = Number(wei) / 10 ** decimals;
  return `${whole % 1 === 0 ? whole : whole.toFixed(Math.min(decimals, 4)).replace(/0+$/, "").replace(/\.$/, "")} ${token}`;
}
