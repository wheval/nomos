// Payment Link encode/decode helpers. A "link" is just the recipient, an
// optional fixed amount, and a merchant-facing note - all carried in the URL
// query string. Nothing is persisted server-side; the link itself is the
// record. Amounts are STRK human units ("5", "1.5"), converted to wei
// (18 decimals) only at submit time.

export type PaymentLinkParams = {
  to: string;
  amount?: string; // absent = customer enters their own amount ("open" request)
  note?: string;
  ref?: string;
  exp?: string; // unix seconds - absent = never expires
};

// Duration choices offered on the create form, in seconds.
export const EXPIRY_CHOICES: { label: string; seconds: number | null }[] = [
  { label: "Never", seconds: null },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "24 hours", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
];

// Parse a human STRK amount ("5", "1.5") into wei (18 decimals). Returns null
// for anything that isn't a positive, sane decimal.
export function parseStrkAmount(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > 18) return null; // more precision than STRK supports
  const fracPadded = frac.padEnd(18, "0");
  try {
    const value = BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded || "0");
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

// Build a shareable /pay URL from an origin + link params.
export function buildPaymentUrl(origin: string, params: PaymentLinkParams): string {
  const url = new URL("/pay", origin);
  url.searchParams.set("to", params.to);
  if (params.amount) url.searchParams.set("amount", params.amount);
  if (params.note) url.searchParams.set("note", params.note);
  if (params.ref) url.searchParams.set("ref", params.ref);
  if (params.exp) url.searchParams.set("exp", params.exp);
  return url.toString();
}

// Short reference id for a payment request - a UI-level note for
// reconciliation, not an on-chain memo (STRK20 transfer actions carry no
// memo field; see docs/architecture notes).
export function makeRef(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
