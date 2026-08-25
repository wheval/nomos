import type { DepositStatus } from "@/server/store";

export function depositStatusLabel(status: DepositStatus): string | null {
  switch (status) {
    case "pending_shield":
      return "Shielding…";
    case "shield_failed":
      return "Shield failed";
    case "rejected":
      return "Rejected";
    case "pending_verify":
      return "Verifying…";
    default:
      return null; // "verified" / "shielded" — already reflected in the balance
  }
}
