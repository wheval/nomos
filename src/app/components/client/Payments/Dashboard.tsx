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
  const shortSecret = secretKey ? `${secretKey.slice(0, 10)}${"•".repeat(14)}` : "";

  return (
    <div className={styles.panelWide}>
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total received</div>
          <div className={styles.statValue}>
            {payments ? totalStrk.toLocaleString() : "—"} <span>STRK</span>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Payments</div>
          <div className={styles.statValue}>{payments ? payments.length : "—"}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Webhook</div>
          <div className={styles.statValue} style={{ fontSize: 16 }}>
            {webhookUrl ? (
              <span style={{ color: "var(--green)" }}>● Active</span>
            ) : (
              <span style={{ color: "var(--muted-2)" }}>Not set</span>
            )}
          </div>
        </div>
      </div>

      <div className={styles.sectionCard}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>API key</span>
        </div>
        <p className={styles.sectionSub}>Public key embeds in the widget. Secret key stays here — bearer auth for GET /api/payments.</p>

        <div className={styles.keyRow}>
          <span className={styles.keyDot} />
          <span className={styles.keyText}>{publicKey ?? "Not generated yet"}</span>
          {publicKey ? <span className={styles.keyBadge}>Public</span> : null}
        </div>

        {justIssued && secretKey ? (
          <div className={styles.keyRow} style={{ marginTop: 8 }} data-secret>
            <span className={styles.keyDot} style={{ background: "var(--pink)" }} />
            <span className={styles.keyText}>{secretKey}</span>
            <span className={styles.keyBadge} style={{ color: "#fff", background: "var(--pink)" }}>Save now</span>
          </div>
        ) : secretKey ? (
          <div className={styles.keyRow} style={{ marginTop: 8 }}>
            <span className={styles.keyDot} style={{ background: "var(--muted-2)" }} />
            <span className={styles.keyText}>{shortSecret}</span>
            <span className={styles.keyBadge} style={{ background: "var(--inset-2)", color: "var(--muted)" }}>Remembered</span>
          </div>
        ) : null}

        <button
          className={`${styles.btn} ${styles.btnGreen} ${styles.btnBlock}`}
          disabled={issuing}
          onClick={handleIssueKey}
          style={{ marginTop: 14 }}
        >
          {issuing ? "Generating…" : publicKey ? "Rotate API key" : "Generate API key"}
        </button>
      </div>

      {secretKey ? (
        <div className={styles.sectionCard}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Webhook</span>
          </div>
          <p className={styles.sectionSub}>POSTed the moment a Payment Link is paid, signed with HMAC-SHA256.</p>

          <div className={styles.field} style={{ marginBottom: 10 }}>
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
            {savingWebhook ? "Saving…" : webhookSaved ? "Saved ✓" : "Save webhook URL"}
          </button>
          <p className={styles.sectionSub} style={{ margin: "12px 0 0" }}>
            Verify by computing <code>sha256(secret key)</code>, HMAC-ing the raw request body
            with it, and comparing to <code>X-Nomos-Signature</code>.
          </p>
        </div>
      ) : null}

      <div className={styles.sectionCard}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Payments received</span>
          {payments?.length ? <span className={styles.sectionMeta}>{payments.length} total</span> : null}
        </div>

        {!secretKey ? (
          <div className={styles.emptyState}>
            <p>Generate an API key above to unlock this list.</p>
          </div>
        ) : loadError ? (
          <div className={styles.errorText}>{loadError}</div>
        ) : payments && payments.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No payments recorded yet — they&apos;ll appear here as your Payment Links get paid.</p>
            <div className={styles.nextSteps} style={{ maxWidth: 260, margin: "0 auto" }}>
              <Link href="/create">Create a Payment Link →</Link>
            </div>
          </div>
        ) : payments ? (
          <div className={styles.txTable}>
            {payments.map((p, i) => (
              <div key={i} className={styles.txRow}>
                <div className={styles.txMain}>
                  <div className={styles.txTitle}>{p.note ?? p.ref ?? "Payment"}</div>
                  <div className={styles.txTime}>{new Date(p.recordedAt * 1000).toLocaleString()}</div>
                </div>
                <div className={styles.txAmount}>{p.amount} STRK</div>
                <a
                  className={styles.txLink}
                  href={explorerTxUrl(myFrontendProviderIndex, p.txHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortHex(p.txHash)} ↗
                </a>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
