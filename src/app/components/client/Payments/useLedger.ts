"use client";

import { useEffect, useState } from "react";
import type { Deposit } from "@/server/store";
import { TokenSymbols, type TokenSymbol } from "@/utils/constants";
import { merchantFetchInit } from "./useMerchantAuth";

type WireDeposit = Omit<Deposit, "amountWei"> & { amountWei: string };
export type TokenBalances = Record<TokenSymbol, string>;

const ZERO_BALANCES: TokenBalances = Object.fromEntries(TokenSymbols.map((t) => [t, "0"])) as TokenBalances;

// Shared deposit-ledger fetch for Overview/Transactions/Payouts - all need
// the same GET /api/payments response, just render different parts of it.
// Balances are per token (STRK, USDC, ...) - never summed together. Also
// scoped by network - test and live never share a balance.
export function useLedger(address: string, secretKey: string | null, networkIndex: number, sessionReady = true) {
  const [deposits, setDeposits] = useState<WireDeposit[] | null>(null);
  const [balances, setBalances] = useState<TokenBalances | null>(null);
  const [loadError, setLoadError] = useState("");

  function refresh() {
    if (!address || !sessionReady) return;
    setLoadError("");
    fetch(`/api/payments?to=${address}&network=${networkIndex}`, merchantFetchInit(secretKey))
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setDeposits(d.deposits ?? []);
        setBalances({ ...ZERO_BALANCES, ...(d.balances ?? {}) });
      })
      .catch((e) => setLoadError(e.message ?? "Could not load payments."));
  }

  useEffect(refresh, [address, secretKey, networkIndex, sessionReady]);

  return { deposits, balances, loadError, refresh };
}
