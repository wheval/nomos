// Exact-match IP allowlist for secret-key API calls. Empty list = allow
// every IP (Paystack's default until you opt in). Dashboard cookie sessions
// never go through this — they're same-origin, not a server calling us.

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function normalizeIp(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value === "::1") return "127.0.0.1";
  if (IPV4.test(value)) {
    const parts = value.split(".").map(Number);
    if (parts.some((n) => n > 255)) return null;
    return value;
  }
  // Loose IPv6: keep as lowercase compressed-or-not, no extra parsing.
  if (value.includes(":")) return value.toLowerCase();
  return null;
}

export function parseIpList(raw: string[]): { ips: string[]; invalid: string[] } {
  const ips: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const normalized = normalizeIp(entry);
    if (!normalized) {
      if (entry.trim()) invalid.push(entry.trim());
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    ips.push(normalized);
  }
  return { ips, invalid };
}

export function clientIpFromHeaders(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0];
    return normalizeIp(first ?? "");
  }
  return normalizeIp(headers.get("x-real-ip") ?? headers.get("cf-connecting-ip") ?? "");
}

export function ipIsAllowed(clientIp: string | null, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!clientIp) return false;
  const normalized = normalizeIp(clientIp);
  if (!normalized) return false;
  return allowlist.some((allowed) => allowed === normalized);
}
