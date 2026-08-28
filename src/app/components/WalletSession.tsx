"use client";

import { useEffect, useRef, useState } from "react";
import { createStore } from "@starknet-io/get-starknet-discovery";
import { walletV6 } from "starknet";
import { WALLET_API } from "@starknet-io/types-js";
import { LAST_WALLET_KEY, readStoredNetworkIndex, writeStoredNetworkIndex } from "@/utils/networks";
import { useFrontendProvider } from "./client/provider/providerContext";
import { useStoreWallet } from "./Wallet/walletContext";
import { rememberAndConnect, refreshConnectedChain } from "./client/WalletHandle/connectWallet";

function normalizeId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Restores the last wallet + Test/Live choice across reloads. If the
// extension session is still valid, this reconnects silently. If Ready
// (or whoever) has locked/timed out, we stay disconnected and the user
// taps Connect once — we do not fake a login.
export default function WalletSession() {
  const setCurrentFrontendProviderIndex = useFrontendProvider((s) => s.setCurrentFrontendProviderIndex);
  const currentFrontendProviderIndex = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const isConnected = useStoreWallet((s) => s.isConnected);
  const tried = useRef(false);
  const [networkReady, setNetworkReady] = useState(false);

  useEffect(() => {
    const stored = readStoredNetworkIndex();
    if (stored !== null) setCurrentFrontendProviderIndex(stored);
    setNetworkReady(true);
  }, [setCurrentFrontendProviderIndex]);

  useEffect(() => {
    if (!networkReady) return;
    writeStoredNetworkIndex(currentFrontendProviderIndex);
  }, [networkReady, currentFrontendProviderIndex]);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    const lastName = window.localStorage.getItem(LAST_WALLET_KEY);
    if (!lastName) return;

    const store = createStore({ eip1193Adapters: [] });
    let cancelled = false;

    async function tryReconnect() {
      const wallets = store.getWallets();
      const found = wallets.find((w) => normalizeId(w.name) === normalizeId(lastName!));
      if (!found || cancelled) return;
      try {
        const perms = (await walletV6.getPermissions(found)) as WALLET_API.Permission[];
        if (!perms.includes(WALLET_API.Permission.ACCOUNTS)) return;
        await rememberAndConnect(found);
      } catch {
        /* extension session gone — leave the user on Connect */
      }
    }

    tryReconnect();
    const unsub = store.subscribe(() => {
      if (!useStoreWallet.getState().isConnected) tryReconnect();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    function onVis() {
      if (document.visibilityState === "visible") refreshConnectedChain();
    }
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    const t = window.setInterval(() => refreshConnectedChain(), 8000);
    return () => {
      window.removeEventListener("focus", onVis);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(t);
    };
  }, [isConnected]);

  return null;
}
