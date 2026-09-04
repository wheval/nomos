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
//
// PROTOTYPE PRICING. These are set an order of magnitude below the schedule
// the model implies, so a demo can move $0.20 rather than being floored at
// $1.10 — a floor in STRK looked absurd (40 STRK) purely because STRK is
// worth under three cents. The consequence is deliberate and worth stating
// plainly: the payout fee no longer covers the ~9.5 STRK a payout actually
// costs on-chain, so Nomos subsidises roughly 7.5 STRK of every withdrawal.
// Fine while the goal is demonstrating the product; not fine at volume. The
// shape is right and only the numbers move — see docs/pricing.
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
    transactionA: 10_000n, //  $0.01
    transactionB: 20_000n, //  $0.02
    payout: 50_000n, //        $0.05
    minimumPayment: 200_000n, //  $0.20
    minimumPayout: 500_000n, //   $0.50
  },
  // 18 decimals. ~$0.028/STRK at time of writing.
  STRK: {
    transactionA: 400_000_000_000_000_000n, //     0.4 STRK ≈ $0.011
    transactionB: 800_000_000_000_000_000n, //     0.8 STRK ≈ $0.022
    payout: 2_000_000_000_000_000_000n, //           2 STRK ≈ $0.055
    minimumPayment: 8_000_000_000_000_000_000n, //   8 STRK ≈ $0.22
    minimumPayout: 20_000_000_000_000_000_000n, //  20 STRK ≈ $0.55
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
