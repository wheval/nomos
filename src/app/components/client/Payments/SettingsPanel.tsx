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
  const { isConnected, address, publicKey, secretKey, justIssued, issuing, issueKey, networkIndex, sessionReady } = useMerchantAuth();

  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [webhookError, setWebhookError] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoError, setLogoError] = useState("");
  const [savingLogo, setSavingLogo] = useState(false);
  const [allowedIps, setAllowedIps] = useState<string[]>([]);
  const [ipDraft, setIpDraft] = useState("");
  const [ipError, setIpError] = useState("");
  const [savingIps, setSavingIps] = useState(false);

  useEffect(() => {
    if (!address || !sessionReady) return;
    fetch(`/api/merchant-webhook?address=${address}&network=${networkIndex}`, {
      credentials: "include",
      headers: secretKey ? { Authorization: `Bearer ${secretKey}` } : {},
    })
      .then((r) => (r.ok ? r.json() : { webhookUrl: null }))
      .then((d) => setWebhookUrl(d.webhookUrl ?? ""))
      .catch(() => {});
    fetch(`/api/merchant-profile?address=${address}&network=${networkIndex}`, {
      credentials: "include",
      headers: secretKey ? { Authorization: `Bearer ${secretKey}` } : {},
    })
      .then((r) => (r.ok ? r.json() : { displayName: null, allowedIps: [] }))
      .then((d) => {
        setDisplayName(d.displayName ?? "");
        setLogoDataUrl(d.logoDataUrl ?? null);
        setAllowedIps(Array.isArray(d.allowedIps) ? d.allowedIps : []);
      })
      .catch(() => {});
  }, [address, secretKey, networkIndex, sessionReady]);

  async function handleSaveWebhook() {
    if (!address || !secretKey) return;
    setSavingWebhook(true);
    setWebhookError("");
    setWebhookSaved(false);
    try {
      const r = await fetch("/api/merchant-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, secretKey, url: webhookUrl.trim(), networkIndex }),
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

  async function handleSaveName() {
    if (!address) return;
    setSavingName(true);
    setNameError("");
    setNameSaved(false);
    try {
      const r = await fetch("/api/merchant-profile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, networkIndex, displayName, ...(secretKey ? { secretKey } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setDisplayName(d.displayName ?? "");
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 1800);
    } catch (e: any) {
      setNameError(e.message ?? "Could not save business name.");
    } finally {
      setSavingName(false);
    }
  }

  async function saveIps(next: string[]) {
    if (!address) return;
    setSavingIps(true);
    setIpError("");
    try {
      const r = await fetch("/api/merchant-profile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, networkIndex, allowedIps: next, ...(secretKey ? { secretKey } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setAllowedIps(d.allowedIps ?? []);
      setIpDraft("");
    } catch (e: any) {
      setIpError(e.message ?? "Could not save IP allowlist.");
    } finally {
      setSavingIps(false);
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
        <p className={styles.consoleSub}>
          Optional. Generate keys only if you want to call Nomos from your own server — the dashboard
          works from your connected wallet alone.
        </p>
      </div>

      <div className={styles.sectionCard}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Business</span>
        </div>
        <p className={styles.sectionSub} style={{ marginTop: -8 }}>
          Name is for your sidebar. Logo shows on checkout when a customer opens a Payment Link.
        </p>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Name</label>
            <input
              className={styles.textInput}
              placeholder="e.g. Sendpay"
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            {nameError ? <div className={styles.errorText}>{nameError}</div> : null}
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Checkout logo</label>
            <div className={styles.logoPicker}>
              {logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.logoPreview} src={logoDataUrl} alt="" />
              ) : null}
              <label className={`${styles.btn} ${styles.btnGhost}`}>
                {savingLogo ? "Saving…" : logoDataUrl ? "Replace" : "Upload"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    setLogoError("");
                    if (!file) return;
                    if (file.size > 120_000) {
                      setLogoError("Keep the image under 120KB.");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = async () => {
                      const result = typeof reader.result === "string" ? reader.result : "";
                      if (!address || !result) return;
                      setSavingLogo(true);
                      try {
                        const r = await fetch("/api/merchant-profile", {
                          method: "POST",
                          credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ address, networkIndex, logoDataUrl: result, ...(secretKey ? { secretKey } : {}) }),
                        });
                        const d = await r.json();
                        if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
                        setLogoDataUrl(d.logoDataUrl ?? result);
                      } catch (err: any) {
                        setLogoError(err.message ?? "Could not save logo.");
                      } finally {
                        setSavingLogo(false);
                      }
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {logoDataUrl ? (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost}`}
                  onClick={async () => {
                    if (!address) return;
                    setSavingLogo(true);
                    setLogoError("");
                    try {
                      const r = await fetch("/api/merchant-profile", {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ address, networkIndex, logoDataUrl: null, ...(secretKey ? { secretKey } : {}) }),
                      });
                      if (!r.ok) throw new Error((await r.json())?.error ?? `HTTP ${r.status}`);
                      setLogoDataUrl(null);
                    } catch (err: any) {
                      setLogoError(err.message ?? "Could not remove logo.");
                    } finally {
                      setSavingLogo(false);
                    }
                  }}
                >
                  Remove
                </button>
              ) : null}
            </div>
            {logoError ? <div className={styles.errorText}>{logoError}</div> : null}
          </div>
        </div>
        <button className={`${styles.btn} ${styles.btnGreen} ${styles.btnBlock}`} disabled={savingName} onClick={handleSaveName}>
          {savingName ? "Saving…" : nameSaved ? "Saved ✓" : "Save business name"}
        </button>
      </div>

      <div className={styles.sectionCard}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>API configuration — {networkIndex === 0 ? "Live" : "Test"} mode</span>
        </div>
        <p className={styles.sectionSub} style={{ marginTop: -8 }}>
          {networkIndex === 0
            ? "Live keys authenticate Mainnet requests from your backend. They are not required to use this dashboard."
            : "Test keys authenticate Sepolia requests from your backend. They are not required to use this dashboard."}
        </p>

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
              <div className={styles.settingsRowDesc}>Bearer token for your server — never share this, never paste it into the dashboard</div>
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
          {issuing ? "Generating…" : publicKey ? "Rotate API key" : "Generate API key for my server"}
        </button>
      </div>

      {secretKey ? (
        <div className={styles.sectionCard}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Webhook</span>
          </div>
          <p className={styles.sectionSub}>
            For your backend. POSTed the moment a Payment Link is paid, signed with HMAC-SHA256 using
            your secret key.
          </p>

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

      {secretKey ? (
        <div className={styles.sectionCard}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>IP allowlist</span>
          </div>
          <p className={styles.sectionSub} style={{ marginTop: -8 }}>
            Optional. Restrict this secret key to your server IPs. Leave empty to allow any IP — the
            dashboard itself is never blocked by this.
          </p>
          {allowedIps.length ? (
            <div className={styles.ipList}>
              {allowedIps.map((ip) => (
                <span key={ip} className={styles.ipChip}>
                  {ip}
                  <button type="button" aria-label={`Remove ${ip}`} onClick={() => void saveIps(allowedIps.filter((x) => x !== ip))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className={styles.sectionSub}>No IPs listed — any IP can use this key.</p>
          )}
          <div className={styles.field} style={{ marginBottom: 10 }}>
            <input
              className={styles.textInput}
              placeholder="e.g. 203.0.113.10"
              value={ipDraft}
              onChange={(e) => setIpDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const next = ipDraft.trim();
                  if (next) void saveIps([...allowedIps, next]);
                }
              }}
            />
            {ipError ? <div className={styles.errorText}>{ipError}</div> : null}
          </div>
          <button
            className={`${styles.btn} ${styles.btnGreen} ${styles.btnBlock}`}
            disabled={savingIps || !ipDraft.trim()}
            onClick={() => void saveIps([...allowedIps, ipDraft])}
          >
            {savingIps ? "Saving…" : "Add IP"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
