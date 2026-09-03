// Makes a private payment identify itself by its amount.
//
// A shielded STRK20 transfer carries exactly two things: a recipient and an
// amount. There is no memo, no note id a payer can target, and giving each
// link its own recipient address would mean deploying and registering an
// account per link. So the amount is the only field that can carry
// information — and it is the one thing Nomos can read off an arriving note.
//
// Every payment attempt is therefore quoted a unique amount a few micro-units
// above the link's price. When the note lands, that amount names exactly one
// intent, and attribution stops being a guess.
//
// The same trick is standard for public-chain processors (BTCPay, Coinbase
// Commerce) where it leaks the payment to anyone watching. Here it does not:
// Flow A amounts are shielded, so only Nomos — holding the viewing key — ever
// sees the fingerprint.
import { isTokenSymbol, tokenDecimals } from "./constants";

// One micro-unit of the token: 1e-6 of it, whatever its decimals. A tenth of
// a cent for USDC, and far less for STRK. Small enough that a payer will not
// care, large enough that no rounding swallows it.
function fingerprintUnit(token: string): bigint {
  // Unknown tokens fall back to 18, the Starknet default; the fingerprint
  // only has to be self-consistent, not exact.
  const decimals = isTokenSymbol(token) ? tokenDecimals(token) : 18;
  return decimals >= 6 ? 10n ** BigInt(decimals - 6) : 1n;
}

// 1000 concurrent attempts at the same price before slots run out — far past
// anything a single link sees at once, and the fallback below is safe anyway.
export const FINGERPRINT_SLOTS = 1000n;

/** The most a payer can be asked to overpay, for display and for tests. */
export function maxFingerprintOverpay(token: string): bigint {
  return (FINGERPRINT_SLOTS - 1n) * fingerprintUnit(token);
}

/**
 * A payable amount that no other open attempt is using.
 *
 * `takenAmounts` is every open intent's amount for this token and network.
 * Returns the base amount plus the lowest free slot.
 *
 * If every slot is taken it returns the base amount unchanged rather than
 * refusing the payment. Attribution then degrades to the ambiguous case, which
 * is reported for a human — a payment that is hard to attribute beats a
 * payment the payer was not allowed to make.
 */
export function uniquePayableAmount(
  baseAmountWei: bigint,
  token: string,
  takenAmounts: Iterable<bigint>
): bigint {
  const unit = fingerprintUnit(token);
  const taken = new Set(takenAmounts);
  for (let slot = 0n; slot < FINGERPRINT_SLOTS; slot++) {
    const candidate = baseAmountWei + slot * unit;
    if (!taken.has(candidate)) return candidate;
  }
  return baseAmountWei;
}
