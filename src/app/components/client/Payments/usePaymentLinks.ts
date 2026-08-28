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

// Remaining time in the largest useful unit — hours, then days after 24h —
// so the list never dumps a raw timestamp the merchant has to convert.
// Returns null for revoked/expired links since the status badge already
// covers that; callers should only render this for active links.
export function expiresInLabel(link: Pick<WirePaymentLink, "revoked" | "expiresAt">): string | null {
  if (link.revoked) return null;
  if (link.expiresAt === undefined) return "Never expires";
  const secondsLeft = link.expiresAt - Date.now() / 1000;
  if (secondsLeft <= 0) return null;

  if (secondsLeft >= 24 * 3600) {
    const days = Math.round(secondsLeft / 86400);
    return `Expires in ${days} day${days === 1 ? "" : "s"}`;
  }
  if (secondsLeft >= 3600) {
    const hours = Math.round(secondsLeft / 3600);
    return `Expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const minutes = Math.max(1, Math.round(secondsLeft / 60));
  return `Expires in ${minutes} min`;
}
