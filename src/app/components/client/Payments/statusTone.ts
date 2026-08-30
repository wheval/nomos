import type { DepositStatus } from "@/server/store";
import styles from "../../../uni.module.css";
import type { WirePaymentLink } from "./usePaymentLinks";

// One mapping from domain state -> visual tone, so "pending" reads the same
// on Overview, Transactions and a link's detail page instead of each call
// site picking its own colour.
export type Tone = "ok" | "warn" | "bad" | "neutral";

export function toneClass(tone: Tone): string {
  return tone === "ok"
    ? styles.statusOk
    : tone === "warn"
      ? styles.statusWarn
      : tone === "bad"
        ? styles.statusBad
        : styles.statusNeutral;
}

export function pillClass(tone: Tone): string {
  return `${styles.statusPill} ${toneClass(tone)}`;
}

// Unlike depositStatusLabel (which returns null for settled states, because
// the old rows only badged exceptions), a table column always needs a value.
export function depositStatus(status: DepositStatus): { label: string; tone: Tone } {
  switch (status) {
    case "verified":
      return { label: "Verified", tone: "ok" };
    case "shielded":
      return { label: "Shielded", tone: "ok" };
    case "pending_verify":
      return { label: "Verifying", tone: "warn" };
    case "pending_shield":
      return { label: "Shielding", tone: "warn" };
    case "shield_failed":
      return { label: "Shield failed", tone: "bad" };
    case "rejected":
      return { label: "Rejected", tone: "bad" };
    default:
      return { label: status, tone: "neutral" };
  }
}

export function linkStatus(
  link: Pick<WirePaymentLink, "revoked" | "expiresAt">,
  now = Date.now() / 1000,
): { label: string; tone: Tone } {
  if (link.revoked) return { label: "Revoked", tone: "bad" };
  if (link.expiresAt !== undefined && link.expiresAt <= now) return { label: "Expired", tone: "neutral" };
  return { label: "Active", tone: "ok" };
}
