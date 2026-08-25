"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../../../uni.module.css";
import { useStoreWallet } from "../../Wallet/walletContext";
import SelectWallet from "../WalletHandle/SelectWallet";
import { buildPaymentUrl, makeRef, parseStrkAmount, EXPIRY_CHOICES } from "@/utils/payments";

// Merchant-facing Payment Link creation. The link IS the record - nothing is
// persisted server-side yet. Recipient is always the connected wallet: you
// can only create a link that pays you.
export default function CreateLink() {
  const isConnected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [expirySeconds, setExpirySeconds] = useState<number | null>(null);
  const [amountError, setAmountError] = useState("");
  const [link, setLink] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  function handleGenerate() {
    setLink("");
    setCopied(false);
    if (amount.trim() && parseStrkAmount(amount) === null) {
      setAmountError("Enter a positive amount, e.g. 25 or 12.5");
      return;
    }
    setAmountError("");
    const exp = expirySeconds ? String(Math.floor(Date.now() / 1000) + expirySeconds) : undefined;
    const url = buildPaymentUrl(window.location.origin, {
      to: address,
      amount: amount.trim() || undefined,
      note: note.trim() || undefined,
      ref: makeRef(),
      exp,
    });
    setLink(url);
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

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>Payment Link</span>
        <span className={styles.sectionMeta}>{shortAddr}</span>
      </div>
      <p className={styles.sectionSub}>Pays into your shielded balance</p>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="amount">
          Amount (STRK) - leave blank to let the customer enter one
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

      <button className={styles.btnCta} onClick={handleGenerate}>
        Generate link
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
    </div>
  );
}
