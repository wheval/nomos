"use client";

import { useEffect, useState } from "react";
import styles from "../../../uni.module.css";
import SelectWallet from "../WalletHandle/SelectWallet";
import { useMerchantAuth } from "./useMerchantAuth";

export default function SettingsPanel() {
  const { isConnected, address, publicKey, secretKey, justIssued, issuing, issueKey } = useMerchantAuth();

  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [webhookError, setWebhookError] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);

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

  if (!isConnected) {
    return (
      <div className={styles.consolePage}>
        <div className={styles.sectionCard} style={{ textAlign: "center" }}>
          <p className={styles.sectionSub}>Connect the wallet your Payment Links pay into to see its console.</p>
          <SelectWallet variant="ctaBig" />
        </div>
      </div>
    );
  }

  const shortSecret = secretKey ? `${secretKey.slice(0, 10)}${"•".repeat(14)}` : "";

  return (
    <div className={styles.consolePage}>
      <div className={styles.consoleHead}>
        <h1 className={styles.consoleTitle}>Settings</h1>
        <p className={styles.consoleSub}>API keys and webhook configuration for your own backend.</p>
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
            <span className={styles.keyDot} style={{ background: "var(--c-accent)" }} />
            <span className={styles.keyText}>{secretKey}</span>
            <span className={styles.keyBadge} style={{ color: "#fff", background: "var(--c-accent)" }}>Save now</span>
          </div>
        ) : secretKey ? (
          <div className={styles.keyRow} style={{ marginTop: 8 }}>
            <span className={styles.keyDot} style={{ background: "var(--c-muted-2)" }} />
            <span className={styles.keyText}>{shortSecret}</span>
            <span className={styles.keyBadge} style={{ background: "var(--c-surface-2)", color: "var(--c-muted)" }}>Remembered</span>
          </div>
        ) : null}

        <button
          className={`${styles.btn} ${styles.btnGreen} ${styles.btnBlock}`}
          disabled={issuing}
          onClick={issueKey}
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
    </div>
  );
}
