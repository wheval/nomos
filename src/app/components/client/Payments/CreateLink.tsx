"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "../../../uni.module.css";
import SelectWallet from "../WalletHandle/SelectWallet";
import { buildPaymentUrl, parseTokenAmount, EXPIRY_CHOICES } from "@/utils/payments";
import { fmtTokenAmount } from "@/utils/receipt";
import { TokenSymbols, tokenDecimals, type TokenSymbol } from "@/utils/constants";
import { useMerchantAuth } from "./useMerchantAuth";

type WireLink = {
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

// Merchant-facing Payment Link creation. Links are persisted server-side
// (src/server/store) rather than encoded entirely in the URL - the
// checkout page fetches the canonical record by id instead of trusting
// whatever's in a copied/edited link, and this list is what makes a
// merchant's own links recoverable and auditable instead of living only in
// whatever chat thread they were shared through.
export default function CreateLink() {
  const { isConnected, address, secretKey } = useMerchantAuth();

  const [token, setToken] = useState<TokenSymbol>("STRK");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [expirySeconds, setExpirySeconds] = useState<number | null>(null);
  const [amountError, setAmountError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [link, setLink] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [links, setLinks] = useState<WireLink[] | null>(null);

  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  function refreshLinks() {
    if (!address || !secretKey) return;
    fetch(`/api/payment-links?to=${address}`, { headers: { Authorization: `Bearer ${secretKey}` } })
      .then((r) => (r.ok ? r.json() : { links: [] }))
      .then((d) => setLinks(d.links ?? []))
      .catch(() => {});
  }

  useEffect(refreshLinks, [address, secretKey]);

  async function handleGenerate() {
    setLink("");
    setCopied(false);
    setFormError("");
    if (amount.trim() && parseTokenAmount(amount, tokenDecimals(token)) === null) {
      setAmountError("Enter a positive amount, e.g. 25 or 12.5");
      return;
    }
    setAmountError("");
    setSubmitting(true);
    try {
      const r = await fetch("/api/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantAddress: address,
          secretKey,
          amount: amount.trim() || undefined,
          token,
          note: note.trim() || undefined,
          expiresIn: expirySeconds ?? undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setLink(buildPaymentUrl(window.location.origin, d.id));
      setAmount("");
      setNote("");
      setExpirySeconds(null);
      refreshLinks();
    } catch (e: any) {
      setFormError(e.message ?? "Could not create the payment link.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard denied - link is still selectable text */
    }
  }

  if (!isConnected) {
    return (
      <div className={styles.sectionCard} style={{ textAlign: "center" }}>
        <p className={styles.sectionSub}>
          Connect the wallet you want paid into before creating a link.
        </p>
        <SelectWallet variant="ctaBig" />
      </div>
    );
  }

  if (!secretKey) {
    return (
      <div className={styles.sectionCard} style={{ textAlign: "center" }}>
        <p className={styles.sectionSub}>
          Generate an API key in Settings first — Payment Links are created
          under your merchant account, the same key that authenticates your
          dashboard and webhooks.
        </p>
        <Link href="/dashboard/settings" className={styles.btnCta} style={{ display: "inline-block", width: "auto", textDecoration: "none" }}>
          Go to Settings →
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>Payment Link</span>
        <span className={styles.sectionMeta}>{shortAddr}</span>
      </div>
      <p className={styles.sectionSub}>Pays into your shielded balance</p>

      <div className={styles.field}>
        <label className={styles.fieldLabel}>Token</label>
        <div className={styles.chipRow}>
          {TokenSymbols.map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.chip} ${token === t ? styles.chipActive : ""}`}
              onClick={() => setToken(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="amount">
          Amount ({token}) - leave blank to let the customer enter one
        </label>
        <input
          id="amount"
          className={styles.textInput}
          placeholder="e.g. 25"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {amountError ? <div className={styles.errorText}>{amountError}</div> : null}
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="note">
          Note (shown to the customer, not written on-chain)
        </label>
        <input
          id="note"
          className={styles.textInput}
          placeholder="e.g. Invoice #104"
          maxLength={120}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel}>Expires</label>
        <div className={styles.chipRow}>
          {EXPIRY_CHOICES.map((choice) => (
            <button
              key={choice.label}
              type="button"
              className={`${styles.chip} ${expirySeconds === choice.seconds ? styles.chipActive : ""}`}
              onClick={() => setExpirySeconds(choice.seconds)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>

      {formError ? <div className={styles.errorText}>{formError}</div> : null}

      <button className={styles.btnCta} disabled={submitting} onClick={handleGenerate}>
        {submitting ? "Generating…" : "Generate link"}
      </button>

      {link ? (
        <div className={styles.field} style={{ marginTop: 16 }}>
          <label className={styles.fieldLabel}>Share this with your customer</label>
          <div className={styles.linkRow}>
            <span className={styles.linkText}>{link}</span>
            <button className={`${styles.btn} ${styles.btnGreen}`} onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className={styles.nextSteps}>
            <a href={link} target="_blank" rel="noreferrer">Preview as customer ↗</a>
            <Link href="/dashboard">View dashboard →</Link>
          </div>
        </div>
      ) : null}

      {links && links.length > 0 ? (
        <div className={styles.field} style={{ marginTop: 24 }}>
          <label className={styles.fieldLabel}>Your Payment Links</label>
          <div className={styles.txTable}>
            {links.map((l) => {
              const url = buildPaymentUrl(typeof window !== "undefined" ? window.location.origin : "", l.id);
              const expired = l.expiresAt !== undefined && Date.now() / 1000 > l.expiresAt;
              return (
                <div key={l.id} className={styles.txRow}>
                  <div className={styles.txMain}>
                    <div className={styles.txTitle}>
                      {l.note ?? l.ref}
                      {l.revoked ? <span className={styles.keyBadge} style={{ marginLeft: 8 }}>revoked</span> : null}
                      {!l.revoked && expired ? <span className={styles.keyBadge} style={{ marginLeft: 8 }}>expired</span> : null}
                    </div>
                    <div className={styles.txTime}>{new Date(l.createdAt * 1000).toLocaleString()}</div>
                  </div>
                  <div className={styles.txAmount}>
                    {l.amountWei !== undefined ? `${fmtTokenAmount(BigInt(l.amountWei), tokenDecimals(l.token as TokenSymbol))} ${l.token}` : "Open"}
                  </div>
                  <a
                    className={styles.txLink}
                    href={url}
                    onClick={(e) => {
                      e.preventDefault();
                      navigator.clipboard.writeText(url).catch(() => {});
                    }}
                    title="Copy link"
                  >
                    Copy ↗
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
