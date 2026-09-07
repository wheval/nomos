"use client";

import { useEffect, useState } from "react";
import type { Signature, TypedData } from "starknet";
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

// ConsoleShell plus the page's own panel both call useMerchantAuth, so every
// console page used to open two sessions and fetch the public key twice —
// and do it again on each navigation. Establishing the session is idempotent
// and its result identical for every caller, so the work is shared: one
// promise per (address, network), reused until the wallet disconnects.
const sessionPromises = new Map<string, Promise<boolean>>();
const publicKeyPromises = new Map<string, Promise<string | null>>();

function authKey(address: string, networkIndex: number) {
  return `${address.toLowerCase()}:${networkIndex}`;
}

type Signer = { signMessage: (typedData: TypedData) => Promise<Signature> };

// Prove the wallet is ours, then exchange that proof for a session.
//
// Connecting a wallet is not proof of anything — an address is public. The
// server issues a challenge, the wallet signs it, and only then is a session
// cookie handed out. Costs the merchant one signature prompt per login; it
// signs a statement, never a transaction, and moves no money.
async function establishSession(
  address: string,
  networkIndex: number,
  signer: Signer
): Promise<boolean> {
  const challengeRes = await fetch(
    `/api/merchant-session?address=${address}&network=${networkIndex}`,
    { credentials: "include" }
  );
  if (!challengeRes.ok) return false;
  const body = (await challengeRes.json()) as {
    authenticated?: boolean;
    challenge?: string;
    typedData?: TypedData;
  };

  // A session lasts two weeks and survives reloads, but the cache above is
  // module state that does not. Without this check the wallet prompted on
  // every refresh for a session the browser was already holding — which is
  // both irritating and the way people are taught to click through prompts
  // they should be reading.
  if (body.authenticated) return true;
  if (!body.challenge || !body.typedData) return false;
  const { challenge, typedData } = body as { challenge: string; typedData: TypedData };

  // Signed as the server built it, never as the client imagines it.
  const signature = await signer.signMessage(typedData);
  const asArray = Array.isArray(signature)
    ? signature.map(String)
    : [signature.r, signature.s].map(String);

  const res = await fetch("/api/merchant-session", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, networkIndex, challenge, signature: asArray }),
  });
  return res.ok;
}

function ensureSession(address: string, networkIndex: number, signer: Signer): Promise<boolean> {
  const key = authKey(address, networkIndex);
  let pending = sessionPromises.get(key);
  if (!pending) {
    pending = establishSession(address, networkIndex, signer)
      .catch(() => false)
      .then((ok) => {
        // A failed session must not be cached, or every later mount inherits
        // the failure and the console never recovers without a reload.
        if (!ok) sessionPromises.delete(key);
        return ok;
      });
    sessionPromises.set(key, pending);
  }
  return pending;
}

function fetchPublicKey(address: string, networkIndex: number): Promise<string | null> {
  const key = authKey(address, networkIndex);
  let pending = publicKeyPromises.get(key);
  if (!pending) {
    pending = fetch(`/api/merchant-key?address=${address}&network=${networkIndex}`)
      .then((r) => r.json())
      .then((d) => d.publicKey ?? null)
      .catch(() => {
        publicKeyPromises.delete(key);
        return null;
      });
    publicKeyPromises.set(key, pending);
  }
  return pending;
}

// Disconnecting invalidates every cached session; without clearing these the
// next connect would reuse a promise for a session the server just dropped.
function endSession(): Promise<void> {
  if (sessionPromises.size === 0 && publicKeyPromises.size === 0) return Promise.resolve();
  sessionPromises.clear();
  publicKeyPromises.clear();
  return fetch("/api/merchant-session", { method: "DELETE", credentials: "include" })
    .then(() => {})
    .catch(() => {});
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
  const myWalletAccount = useStoreWallet((state) => state.myWalletAccount);
  const networkIndex = useFrontendProvider((state) => state.currentFrontendProviderIndex);

  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [justIssued, setJustIssued] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!address) {
      setPublicKey(null);
      setSecretKey(null);
      setJustIssued(false);
      setSessionReady(false);
      void endSession();
      return;
    }

    const stored = window.localStorage.getItem(secretKeyStorageKey(address, networkIndex));
    setSecretKey(stored);

    // Both promises are shared across every hook instance, so the six
    // components mounting this on a page cost one session POST and one key
    // GET between them — and a repeat mount (navigating between console
    // pages) resolves from the settled promise without another round-trip.
    // No signer yet (the wallet object arrives a tick after the address on a
    // restored connection) means no session yet — this effect re-runs when it
    // lands, rather than opening an unproven one.
    if (myWalletAccount) {
      void ensureSession(address, networkIndex, myWalletAccount).then((ok) => {
        if (!cancelled) setSessionReady(ok);
      });
    }
    void fetchPublicKey(address, networkIndex).then((key) => {
      if (!cancelled) setPublicKey(key);
    });

    return () => {
      cancelled = true;
    };
  }, [address, networkIndex, myWalletAccount]);

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
      // Rotating the key changes what the shared fetch would return, so seed
      // the cache with the new value instead of letting the next mount serve
      // the pre-rotation key.
      publicKeyPromises.set(authKey(address, networkIndex), Promise.resolve(d.publicKey ?? null));
      window.localStorage.setItem(secretKeyStorageKey(address, networkIndex), d.secretKey);
    } finally {
      setIssuing(false);
    }
  }

  return { isConnected, address, networkIndex, publicKey, secretKey, justIssued, issuing, issueKey, sessionReady };
}
