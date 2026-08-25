"use client";

import { useEffect, useState } from "react";
import { useStoreWallet } from "../../Wallet/walletContext";

function secretKeyStorageKey(address: string) {
  return `nomos:sk:${address.toLowerCase()}`;
}

// Shared across every console page: the connected merchant's address, API
// public/secret key state, and key issuance. Split out of what used to be
// one monolithic Dashboard component so Overview/Transactions/Payouts/
// Settings can each pull just this without re-deriving it.
export function useMerchantAuth() {
  const isConnected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);

  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [justIssued, setJustIssued] = useState(false);
  const [issuing, setIssuing] = useState(false);

  useEffect(() => {
    if (!address) return;
    setPublicKey(null);
    setJustIssued(false);
    const stored = window.localStorage.getItem(secretKeyStorageKey(address));
    setSecretKey(stored);
    fetch(`/api/merchant-key?address=${address}`)
      .then((r) => r.json())
      .then((d) => setPublicKey(d.publicKey ?? null))
      .catch(() => {});
  }, [address]);

  async function issueKey() {
    if (!address) return;
    setIssuing(true);
    try {
      const r = await fetch("/api/merchant-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const d = await r.json();
      setPublicKey(d.publicKey);
      setSecretKey(d.secretKey);
      setJustIssued(true);
      window.localStorage.setItem(secretKeyStorageKey(address), d.secretKey);
    } finally {
      setIssuing(false);
    }
  }

  return { isConnected, address, publicKey, secretKey, justIssued, issuing, issueKey };
}
