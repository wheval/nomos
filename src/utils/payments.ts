// Payment Link helpers. A link is a persisted record (src/server/store —
// merchant, amount, token, note, expiry) identified by an opaque id; the
// shareable URL just carries that id, and the checkout page fetches the
// canonical record by id (GET /api/payment-links/[id]) rather than trusting
// URL params directly. Amounts are human units ("5", "1.5") in whichever
// token the link specifies, converted to the smallest unit only at submit
// time.

// Duration choices offered on the create form, in seconds.
export const EXPIRY_CHOICES: { label: string; seconds: number | null }[] = [
  { label: "Never", seconds: null },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "24 hours", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
];

// Parse a human token amount ("5", "1.5") into its smallest unit, at the
// given decimals. Returns null for anything that isn't a positive, sane
// decimal, or that carries more precision than the token supports.
export function parseTokenAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) return null;
  const fracPadded = frac.padEnd(decimals, "0");
  try {
    const value = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

// Parse a human STRK amount ("5", "1.5") into wei (18 decimals).
export function parseStrkAmount(input: string): bigint | null {
  return parseTokenAmount(input, 18);
}

// Build a shareable /pay URL for a persisted Payment Link id.
export function buildPaymentUrl(origin: string, id: string): string {
  const url = new URL("/pay", origin);
  url.searchParams.set("id", id);
  return url.toString();
}
