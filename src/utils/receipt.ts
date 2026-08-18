// Shared formatting + receipt-shaping helpers for STRK20 actions. Used by
// both the wallet panel (shield/send/unshield/echo/balances) and the
// Payment Link checkout flow, so a transaction reads the same way everywhere.
import { num } from "starknet";

// Format a felt amount (STRK, 18 decimals) as a human STRK string ("10", "1.5").
export function fmtStrk(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  const frac = (amount % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// Shorten a felt/hex for display, like the wallet address ("0x1dc5a1c...1927a").
export function shortHex(h: string): string {
  const hex = num.toHex(h);
  return hex.length <= 13 ? hex : `${hex.slice(0, 7)}...${hex.slice(-4)}`;
}

export type ResultRow = { label: string; value: string; hash?: string };
export type ActionResult = {
  status: "pending" | "ok" | "error";
  title: string;
  rows?: ResultRow[];
  note?: string;
};

// Pretty on-chain status, e.g. "Accepted on L2 · Succeeded".
export function prettyStatus(finality?: string, exec?: string): string {
  const f =
    finality === "ACCEPTED_ON_L2" ? "Accepted on L2"
      : finality === "ACCEPTED_ON_L1" ? "Accepted on L1"
      : finality === "RECEIVED" ? "Received"
      : finality ?? "";
  const e =
    exec === "SUCCEEDED" ? "Succeeded" : exec === "REVERTED" ? "Reverted" : "";
  return [f, e].filter(Boolean).join(" · ") || "Confirmed";
}

// Turn a raw tx receipt into a readable receipt card (amount, status, fee, events, hash).
export function receiptToResult(txR: any, txH: string, amountLabel: string): ActionResult {
  const r = txR?.value ?? txR;
  const exec: string | undefined = r?.execution_status;
  const finality: string | undefined = r?.finality_status;
  const reverted = exec === "REVERTED";
  let feeStr: string | undefined;
  const feeRaw = r?.actual_fee?.amount ?? r?.actual_fee;
  try {
    if (feeRaw !== undefined && feeRaw !== null) feeStr = `${fmtStrk(num.toBigInt(feeRaw))} STRK`;
  } catch {
    /* leave fee undefined if unparseable */
  }
  const evCount = Array.isArray(r?.events) ? r.events.length : undefined;
  const rows: ResultRow[] = [];
  if (amountLabel) rows.push({ label: "Amount", value: amountLabel });
  rows.push({ label: "Status", value: prettyStatus(finality, exec) });
  if (feeStr) rows.push({ label: "Network fee", value: feeStr });
  if (evCount !== undefined) rows.push({ label: "Events", value: String(evCount) });
  rows.push({ label: "Transaction", value: shortHex(txH), hash: txH });
  return {
    status: reverted ? "error" : "ok",
    title: reverted ? "Transaction reverted" : "Transaction confirmed",
    rows,
  };
}

// A failed / rejected action.
export function errorResult(msg: string): ActionResult {
  return { status: "error", title: "Action failed", note: msg };
}

// Voyager explorer link for a tx hash, given the current frontend provider index
// (0 = Mainnet, 2 = Sepolia - see src/utils/constants.ts).
export function explorerTxUrl(providerIndex: number, h: string): string {
  return providerIndex === 0
    ? `https://voyager.online/tx/${h}`
    : `https://sepolia.voyager.online/tx/${h}`;
}
