"use client";

import { useEffect, useState } from "react";
import type { Deposit } from "@/server/store";

type WireDeposit = Omit<Deposit, "amountWei"> & { amountWei: string };

// Shared deposit-ledger fetch for Overview/Transactions - both need the
// same GET /api/payments response, just render different amounts of it.
export function useLedger(address: string, secretKey: string | null) {
  const [deposits, setDeposits] = useState<WireDeposit[] | null>(null);
  const [balanceWei, setBalanceWei] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  function refresh() {
    if (!address || !secretKey) return;
    setLoadError("");
    fetch(`/api/payments?to=${address}`, { headers: { Authorization: `Bearer ${secretKey}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setDeposits(d.deposits ?? []);
        setBalanceWei(d.balanceWei ?? "0");
      })
      .catch((e) => setLoadError(e.message ?? "Could not load payments."));
  }

  useEffect(refresh, [address, secretKey]);

  return { deposits, balanceWei, loadError, refresh };
}
