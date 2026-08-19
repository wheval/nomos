"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "../../../uni.module.css";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";
import SelectWallet from "../WalletHandle/SelectWallet";
import { explorerTxUrl, shortHex } from "@/utils/receipt";
import type { PaymentRecord } from "@/utils/store";

function secretKeyStorageKey(address: string) {
  return `nomos:sk:${address.toLowerCase()}`;
}

// Merchant dashboard: API key issuance + the payments list it unlocks. Reads
// only Nomos's own order records (src/utils/store.ts) - not a scan of the
// STRK20 pool itself, so it needs no viewing-key material at all. See the
// call-prep doc for why that distinction matters.
export default function Dashboard() {
  const isConnected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);
  const myFrontendProviderIndex = useFrontendProvider((state) => state.currentFrontendProviderIndex);

  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [justIssued, setJustIssued] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [payments, setPayments] = useState<PaymentRecord[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [webhookError, setWebhookError] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);

  // Load any existing public key + locally-remembered secret key for this address.
  useEffect(() => {
    if (!address) return;
    setPublicKey(null);
    setPayments(null);
    setJustIssued(false);
    const stored = window.localStorage.getItem(secretKeyStorageKey(address));
    setSecretKey(stored);
    fetch(`/api/merchant-key?address=${address}`)
      .then((r) => r.json())
      .then((d) => setPublicKey(d.publicKey ?? null))
      .catch(() => {});
  }, [address]);

  // Fetch the payments list whenever we have both an address and a secret key.
  useEffect(() => {
    if (!address || !secretKey) return;
    setLoadError("");
    fetch(`/api/payments?to=${address}`, { headers: { Authorization: `Bearer ${secretKey}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setPayments(d.payments ?? []))
      .catch((e) => setLoadError(e.message ?? "Could not load payments."));
  }, [address, secretKey]);

  // Load the currently-saved webhook URL, same auth as the payments list.
  useEffect(() => {
    if (!address || !secretKey) return;
    fetch(`/api/merchant-webhook?address=${address}`, { headers: { Authorization: `Bearer ${secretKey}` } })
      .then((r) => (r.ok ? r.json() : { webhookUrl: null }))
      .then((d) => setWebhookUrl(d.webhookUrl ?? ""))
      .catch(() => {});
  }, [address, secretKey]);

  async function handleSaveWebhook() {
    if (!address || !secretKey) return;
    setSavingWebhook(true);
    setWebhookError("");
    setWebhookSaved(false);
    try {
      const r = await fetch("/api/merchant-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, secretKey, url: webhookUrl.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setWebhookSaved(true);
      setTimeout(() => setWebhookSaved(false), 1800);
    } catch (e: any) {
      setWebhookError(e.message ?? "Could not save webhook URL.");
    } finally {
      setSavingWebhook(false);
    }
  }

  async function handleIssueKey() {
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

  if (!isConnected) {
    return (
      <div className={styles.panel}>
        <p className={styles.heroSub} style={{ marginBottom: 18 }}>
          Connect the wallet your Payment Links pay into to see its dashboard.
        </p>
        <SelectWallet variant="ctaBig" />
      </div>
    );
  }

  const totalStrk = (payments ?? []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  return (
    <div className={styles.panel}>
      <div className={styles.inputBlock}>
        <div className={styles.inputLabel}>API key</div>
        <div className={styles.subLine}>
          <span>Public key embeds in the widget; secret key stays here</span>
        </div>
      </div>

      <div className={styles.summaryCard}>
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Public key</span>
          <span className={styles.summaryValue}>{publicKey ?? "not generated yet"}</span>
        </div>
      </div>

      {justIssued && secretKey ? (
        <div className={styles.field}>
          <label className={styles.fieldLabel}>
            Secret key — shown once, save it now. Used to call GET /api/payments.
          </label>
          <div className={styles.linkRow}>
            <span className={styles.linkText}>{secretKey}</span>
          </div>
        </div>
      ) : null}

      <button className={`${styles.btn} ${styles.btnGreen} ${styles.btnBlock}`} disabled={issuing} onClick={handleIssueKey}>
        {issuing ? "Generating…" : publicKey ? "Rotate API key" : "Generate API key"}
      </button>

      {secretKey ? (
        <>
          <div className={styles.inputBlock} style={{ marginTop: 28 }}>
            <div className={styles.inputLabel}>Webhook</div>
            <div className={styles.subLine}>
              <span>POSTed the moment a Payment Link is paid</span>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="webhookUrl">
              Your endpoint (https://…)
            </label>
            <input
              id="webhookUrl"
              className={styles.textInput}
              placeholder="https://your-backend.example.com/webhooks/nomos"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
            {webhookError ? <div className={styles.errorText}>{webhookError}</div> : null}
          </div>
          <button className={`${styles.btn} ${styles.btnGreen} ${styles.btnBlock}`} disabled={savingWebhook} onClick={handleSaveWebhook}>
            {savingWebhook ? "Saving…" : webhookSaved ? "Saved" : "Save webhook URL"}
          </button>
          <p className={styles.heroSub} style={{ margin: "10px 0 0", fontSize: 12.5, textAlign: "left" }}>
            Each delivery is signed: verify by computing sha256(your secret key), HMAC-ing the
            raw request body with it, and comparing to the <code>X-Nomos-Signature</code> header.
          </p>
        </>
      ) : null}

      <div className={styles.inputBlock} style={{ marginTop: 28 }}>
        <div className={styles.inputLabel}>Payments received</div>
        <div className={styles.subLine}>
          <span>{payments ? `${payments.length} recorded · ${totalStrk} STRK total` : "—"}</span>
        </div>
      </div>

      {!secretKey ? (
        <p className={styles.heroSub} style={{ margin: "8px 0 0", fontSize: 14 }}>
          Generate an API key above to unlock this list.
        </p>
      ) : loadError ? (
        <div className={styles.errorText}>{loadError}</div>
      ) : payments && payments.length === 0 ? (
        <>
          <p className={styles.heroSub} style={{ margin: "8px 0 0", fontSize: 14 }}>
            No payments recorded yet — they'll appear here as your Payment Links get paid.
          </p>
          <div className={styles.nextSteps}>
            <Link href="/create">Create a Payment Link →</Link>
          </div>
        </>
      ) : payments ? (
        <div className={styles.receiptRows} style={{ marginTop: 8 }}>
          {payments.map((p, i) => (
            <div key={i} className={styles.receiptRow}>
              <span className={styles.receiptLabel}>
                {p.note ?? p.ref ?? "Payment"}
                <br />
                <span style={{ fontSize: 11, opacity: 0.7 }}>
                  {new Date(p.recordedAt * 1000).toLocaleString()}
                </span>
              </span>
              <a
                className={styles.receiptLink}
                href={explorerTxUrl(myFrontendProviderIndex, p.txHash)}
                target="_blank"
                rel="noreferrer"
              >
                {p.amount} STRK · {shortHex(p.txHash)} ↗
              </a>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
