"use client";

import { useEffect, useState } from "react";
import styles from "../../../uni.module.css";
import SelectWallet from "../WalletHandle/SelectWallet";
import { useMerchantAuth } from "./useMerchantAuth";

function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      {off ? (
        <>
          <path
            d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.5A9.9 9.9 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.3 3.5M6.3 6.9C4.4 8.1 3 9.9 2 12c1 2.5 5 7 10 7 1 0 2-.2 2.9-.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <path
            d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
        </>
      )}
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.iconBtn}
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard denied - value is still selectable text */
        }
      }}
    >
      {copied ? "✓" : <CopyIcon />}
    </button>
  );
}

export default function SettingsPanel() {
  const { isConnected, address, publicKey, secretKey, justIssued, issuing, issueKey } = useMerchantAuth();

  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [webhookError, setWebhookError] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [secretRevealed, setSecretRevealed] = useState(false);

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

  const maskedSecret = secretKey ? `${secretKey.slice(0, 6)}${"•".repeat(22)}` : "";

  return (
    <div className={styles.consolePage}>
      <div className={styles.consoleHead}>
        <h1 className={styles.consoleTitle}>Settings</h1>
        <p className={styles.consoleSub}>API keys and webhook configuration for your own backend.</p>
      </div>

      <div className={styles.sectionCard}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>API configuration</span>
        </div>

        <div className={styles.settingsRow}>
          <div className={styles.settingsRowLeft}>
            <div className={styles.settingsRowLabel}>Public key</div>
            <div className={styles.settingsRowDesc}>Safe to embed in the checkout widget</div>
          </div>
          <div className={styles.settingsRowRight}>
            {publicKey ? (
              <div className={styles.secretField}>
                <span className={styles.secretFieldValue}>{publicKey}</span>
                <CopyButton value={publicKey} />
              </div>
            ) : (
              <span className={styles.consoleSub}>Not generated yet</span>
            )}
          </div>
        </div>

        {secretKey ? (
          <div className={styles.settingsRow}>
            <div className={styles.settingsRowLeft}>
              <div className={styles.settingsRowLabel}>Secret key</div>
              <div className={styles.settingsRowDesc}>Bearer auth for GET /api/payments — never share this</div>
            </div>
            <div className={styles.settingsRowRight}>
              <div className={styles.secretField}>
                <span className={styles.secretFieldValue}>{secretRevealed ? secretKey : maskedSecret}</span>
                <button
                  type="button"
                  className={styles.iconBtn}
                  title={secretRevealed ? "Hide" : "Reveal"}
                  onClick={() => setSecretRevealed((v) => !v)}
                >
                  <EyeIcon off={secretRevealed} />
                </button>
                <CopyButton value={secretKey} />
              </div>
            </div>
          </div>
        ) : null}

        {justIssued && secretKey ? (
          <div className={styles.warn} style={{ padding: "8px 0 0" }}>
            Save your secret key now — it won&apos;t be shown again after you leave this page.
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
