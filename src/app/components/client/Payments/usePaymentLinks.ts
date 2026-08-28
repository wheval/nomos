"use client";

import { useEffect, useState } from "react";
import { merchantFetchInit } from "./useMerchantAuth";

export type WirePaymentLink = {
  id: string;
  merchantAddress: string;
  networkIndex: number;
  amountWei?: string;
  token: string;
  note?: string;
  ref: string;
  expiresAt?: number;
  revoked: boolean;
  createdAt: number;
};

// Shared Payment Link fetch for CreateLink/Overview — both need the same
// GET /api/payment-links response, just render different slices of it.
// Scoped by network - a link created in test mode never shows up in live
// mode's list, and vice versa.
export function usePaymentLinks(address: string, secretKey: string | null, networkIndex: number, sessionReady = true) {
  const [links, setLinks] = useState<WirePaymentLink[] | null>(null);
  const [loadError, setLoadError] = useState("");

  function refresh() {
    if (!address || !sessionReady) return;
    setLoadError("");
    fetch(`/api/payment-links?to=${address}&network=${networkIndex}`, merchantFetchInit(secretKey))
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setLinks(d.links ?? []))
      .catch((e) => setLoadError(e.message ?? "Could not load payment links."));
  }

  useEffect(refresh, [address, secretKey, networkIndex, sessionReady]);

  return { links, loadError, refresh };
}

export function paymentLinkStatusLabel(link: Pick<WirePaymentLink, "revoked" | "expiresAt">): string | null {
  if (link.revoked) return "Revoked";
  if (link.expiresAt !== undefined && Date.now() / 1000 > link.expiresAt) return "Expired";
  return null; // active — no badge needed
}

// "Expires in 2h 15m" for an active link with an expiry set; null when
// revoked, already expired (paymentLinkStatusLabel covers those), or the
// link never expires.
export function expiresInLabel(link: Pick<WirePaymentLink, "revoked" | "expiresAt">): string | null {
  if (link.revoked || link.expiresAt === undefined) return null;
  const secondsLeft = link.expiresAt - Date.now() / 1000;
  if (secondsLeft <= 0) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 1) return `Expires in ${days}d`;
  if (hours >= 1) return `Expires in ${hours}h ${minutes % 60}m`;
  if (minutes >= 1) return `Expires in ${minutes}m`;
  return "Expires in <1m";
}
