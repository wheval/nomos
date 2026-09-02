"use client";

import type { Deposit } from "@/server/store";
import { TokenSymbols, type TokenSymbol } from "@/utils/constants";
import { merchantFetchInit } from "./useMerchantAuth";
import { useResource } from "./resourceCache";

type WireDeposit = Omit<Deposit, "amountWei" | "feeWei"> & { amountWei: string; feeWei?: string };
export type { WireDeposit };
export type TokenBalances = Record<TokenSymbol, string>;

const ZERO_BALANCES: TokenBalances = Object.fromEntries(TokenSymbols.map((t) => [t, "0"])) as TokenBalances;

// Shared deposit-ledger fetch for Overview/Transactions/Payouts - all need
// the same GET /api/payments response, just render different parts of it.
// Balances are per token (STRK, USDC, ...) - never summed together. Also
// scoped by network - test and live never share a balance.
type LedgerData = { deposits: WireDeposit[]; balances: TokenBalances };

export function ledgerCacheKey(address: string, networkIndex: number) {
  return `payments:${address}:${networkIndex}`;
}

export function useLedger(address: string, secretKey: string | null, networkIndex: number, sessionReady = true) {
  const key = address && sessionReady ? ledgerCacheKey(address, networkIndex) : null;

  const { data, error, refresh } = useResource<LedgerData>(key, async () => {
    const r = await fetch(`/api/payments?to=${address}&network=${networkIndex}`, merchantFetchInit(secretKey));
    if (!r.ok) throw new Error((await r.json())?.error ?? `HTTP ${r.status}`);
    const d = await r.json();
    return {
      deposits: d.deposits ?? [],
      balances: { ...ZERO_BALANCES, ...(d.balances ?? {}) },
    };
  });

  return {
    // null (not []) while the first load is in flight — callers render a
    // loading state off that distinction.
    deposits: data?.deposits ?? null,
    balances: data?.balances ?? null,
    loadError: error ?? "",
    refresh,
  };
}
