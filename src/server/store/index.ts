// Store driver selection. NOMOS_STORE_DRIVER:
//   "memory"   — tests/CI, no external state (default when unset in test env)
//   "file"     — local dev convenience, .data/*.json, not durable on Vercel
//   "supabase" — the real, durable driver; requires SUPABASE_URL +
//                SUPABASE_SERVICE_ROLE_KEY
import type { Store } from "./types";
import { MemoryStore } from "./memoryStore";
import { FileStore } from "./fileStore";
import { SupabaseStore } from "./supabaseStore";

let instance: Store | undefined;

export function getStore(): Store {
  if (instance) return instance;

  const driver = process.env.NOMOS_STORE_DRIVER ?? "file";
  switch (driver) {
    case "memory":
      instance = new MemoryStore();
      break;
    case "supabase":
      instance = new SupabaseStore();
      break;
    case "file":
      instance = new FileStore();
      break;
    default:
      throw new Error(`Unknown NOMOS_STORE_DRIVER: "${driver}". Expected memory | file | supabase.`);
  }
  return instance;
}

export type {
  CreatePaymentLinkInput,
  CreatePayoutInput,
  Deposit,
  DepositStatus,
  Flow,
  LedgerDirection,
  LedgerEntry,
  LedgerKind,
  MerchantKey,
  NetworkIndex,
  PaymentLink,
  Payout,
  PayoutMode,
  PayoutStatus,
  RecordDepositInput,
  Store,
} from "./types";
export { InsufficientBalanceError } from "./types";
