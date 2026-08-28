"use client";

import { useEffect, useState } from "react";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";

function secretKeyStorageKey(address: string, networkIndex: number) {
  return `nomos:sk:${address.toLowerCase()}:${networkIndex}`;
}

export function merchantFetchInit(secretKey: string | null, extra?: RequestInit): RequestInit {
  const headers = new Headers(extra?.headers);
  if (secretKey) headers.set("Authorization", `Bearer ${secretKey}`);
  return { ...extra, credentials: "include", headers };
}

// Shared across every console page: the connected merchant's address is
// the dashboard login. API keys are optional (Settings) for calling Nomos
// from a merchant's own backend — they are not required to create links,
// view transactions, or pay out.
//
// Test and live are entirely separate API keys (see docs/ARCHITECTURE.md) -
// switching networkIndex re-derives everything below from scratch, the
// same way switching Paystack's Test/Live toggle shows a different key pair.
export function useMerchantAuth() {
  const isConnected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);
  const networkIndex = useFrontendProvider((state) => state.currentFrontendProviderIndex);

  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [justIssued, setJustIssued] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    if (!address) {
      setPublicKey(null);
      setSecretKey(null);
      setJustIssued(false);
      setSessionReady(false);
      fetch("/api/merchant-session", { method: "DELETE", credentials: "include" }).catch(() => {});
      return;
    }
    setPublicKey(null);
    setJustIssued(false);
    setSessionReady(false);
    const stored = window.localStorage.getItem(secretKeyStorageKey(address, networkIndex));
    setSecretKey(stored);
    fetch(`/api/merchant-key?address=${address}&network=${networkIndex}`)
      .then((r) => r.json())
      .then((d) => setPublicKey(d.publicKey ?? null))
      .catch(() => {});
    fetch("/api/merchant-session", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, networkIndex }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("session");
        setSessionReady(true);
      })
      .catch(() => setSessionReady(false));
  }, [address, networkIndex]);

  async function issueKey() {
    if (!address) return;
    setIssuing(true);
    try {
      const r = await fetch("/api/merchant-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, networkIndex }),
      });
      const d = await r.json();
      setPublicKey(d.publicKey);
      setSecretKey(d.secretKey);
      setJustIssued(true);
      window.localStorage.setItem(secretKeyStorageKey(address, networkIndex), d.secretKey);
    } finally {
      setIssuing(false);
    }
  }

  return { isConnected, address, networkIndex, publicKey, secretKey, justIssued, issuing, issueKey, sessionReady };
}
