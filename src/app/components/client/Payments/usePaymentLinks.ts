"use client";

import { useEffect, useState } from "react";

export type WirePaymentLink = {
  id: string;
  merchantAddress: string;
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
export function usePaymentLinks(address: string, secretKey: string | null) {
  const [links, setLinks] = useState<WirePaymentLink[] | null>(null);
  const [loadError, setLoadError] = useState("");

  function refresh() {
    if (!address || !secretKey) return;
    setLoadError("");
    fetch(`/api/payment-links?to=${address}`, { headers: { Authorization: `Bearer ${secretKey}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setLinks(d.links ?? []))
      .catch((e) => setLoadError(e.message ?? "Could not load payment links."));
  }

  useEffect(refresh, [address, secretKey]);

  return { links, loadError, refresh };
}

export function paymentLinkStatusLabel(link: Pick<WirePaymentLink, "revoked" | "expiresAt">): string | null {
  if (link.revoked) return "Revoked";
  if (link.expiresAt !== undefined && Date.now() / 1000 > link.expiresAt) return "Expired";
  return null; // active — no badge needed
}
