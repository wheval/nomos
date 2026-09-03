"use client";

import { useSearchParams } from "next/navigation";
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

type TabId = "profile" | "branding" | "keys" | "webhook" | "ips";
const TAB_IDS: TabId[] = ["profile", "branding", "keys", "webhook", "ips"];
type TabDef = { id: TabId; label: string; icon: () => React.ReactElement };

const BUSINESS_TABS: TabDef[] = [
  { id: "profile", label: "Profile", icon: ProfileIcon },
  { id: "branding", label: "Branding", icon: BrandingIcon },
];
const DEVELOPER_TABS: TabDef[] = [
  { id: "keys", label: "API keys", icon: KeyIcon },
  { id: "webhook", label: "Webhook", icon: WebhookIcon },
  { id: "ips", label: "IP allowlist", icon: ShieldIcon },
];

export default function SettingsPanel() {
  const { isConnected, address, publicKey, secretKey, justIssued, issuing, issueKey, networkIndex, sessionReady } = useMerchantAuth();
  // Honour ?tab= so the console can link straight to a pane — the sidebar's
  // Developers item lands on API keys rather than dumping the merchant on
  // Profile and making them hunt.
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState<TabId>(
    TAB_IDS.includes(requestedTab as TabId) ? (requestedTab as TabId) : "profile"
  );

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

  function renderTab({ id, label, icon: Icon }: TabDef) {
    return (
      <button
        key={id}
        type="button"
        className={`${styles.settingsNavItem} ${tab === id ? styles.settingsNavItemActive : ""}`}
        aria-current={tab === id ? "page" : undefined}
        onClick={() => setTab(id)}
      >
        <Icon />
        {label}
      </button>
    );
  }

  async function handleLogoFile(file: File) {
    setLogoError("");
    if (file.size > 120_000) {
      setLogoError("Keep the image under 120KB.");
      return;
    }
    const result = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.readAsDataURL(file);
    });
    if (!address || !result) return;
    await saveLogo(result);
  }

  async function saveLogo(next: string | null) {
    if (!address) return;
    setSavingLogo(true);
    setLogoError("");
    try {
      const r = await fetch("/api/merchant-profile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, networkIndex, logoDataUrl: next, ...(secretKey ? { secretKey } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setLogoDataUrl(next === null ? null : d.logoDataUrl ?? next);
    } catch (err: any) {
      setLogoError(err.message ?? "Could not save logo.");
    } finally {
      setSavingLogo(false);
    }
  }

  if (!isConnected) {
    return (
      <div className={styles.consolePage}>
        <div className={styles.cPanel}>
          <div className={styles.connectPrompt}>
            <p className={styles.sectionSub}>Connect the wallet your Payment Links pay into to see its console.</p>
            <SelectWallet variant="ctaBig" />
          </div>
        </div>
      </div>
    );
  }

  const maskedSecret = secretKey ? `${secretKey.slice(0, 6)}${"•".repeat(22)}` : "";
  const modeLabel = networkIndex === 0 ? "Live" : "Test";

  return (
    <div className={styles.consolePage}>
      <div className={styles.cPanel}>
        <div className={styles.settingsLayout}>
          <nav className={styles.settingsNav}>
            <h1 className={styles.settingsNavTitle}>Settings</h1>

            <div className={styles.settingsNavGroup}>Business</div>
            {BUSINESS_TABS.map(renderTab)}

            <div className={styles.settingsNavGroup}>Developers</div>
            {DEVELOPER_TABS.map(renderTab)}
          </nav>

          <div className={styles.settingsPane}>
            {tab === "profile" ? (
              <>
                <h2 className={styles.settingsPaneTitle}>Profile</h2>
                <p className={styles.settingsPaneDesc}>
                  Your business name identifies this account across the console.
                </p>
                <div className={styles.settingsField}>
                  <label className={styles.settingsLabel} htmlFor="businessName">
                    Business name
                  </label>
                  <input
                    id="businessName"
                    className={styles.settingsInput}
                    placeholder="e.g. Sendpay"
                    maxLength={80}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                  {nameError ? <div className={styles.errorText}>{nameError}</div> : null}
                </div>
                <div className={styles.settingsField}>
                  <label className={styles.settingsLabel}>Wallet</label>
                  <input className={styles.settingsInput} value={address} readOnly disabled />
                  <p className={styles.settingsHint}>
                    Payment Links pay into this wallet. Disconnect from the sidebar to switch.
                  </p>
                </div>
                <button className={styles.settingsBtn} disabled={savingName} onClick={handleSaveName}>
                  {savingName ? "Saving…" : nameSaved ? "Saved ✓" : "Save changes"}
                </button>
              </>
            ) : null}

            {tab === "branding" ? (
              <>
                <h2 className={styles.settingsPaneTitle}>Branding</h2>
                <p className={styles.settingsPaneDesc}>
                  Your logo shows on checkout when a customer opens one of your Payment Links.
                </p>
                <label className={styles.settingsLabel}>Business logo</label>
                <div className={styles.settingsLogoRow}>
                  {logoDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className={styles.settingsLogoPreview} src={logoDataUrl} alt="" />
                  ) : (
                    <div className={styles.settingsLogoEmpty}>None</div>
                  )}
                  {logoDataUrl ? (
                    <button
                      type="button"
                      className={styles.settingsLogoDelete}
                      title="Remove logo"
                      disabled={savingLogo}
                      onClick={() => void saveLogo(null)}
                    >
                      <TrashIcon />
                    </button>
                  ) : null}
                </div>
                <label className={styles.settingsBtn} style={{ cursor: "pointer" }}>
                  <UploadIcon />
                  {savingLogo ? "Saving…" : logoDataUrl ? "Change logo" : "Upload logo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void handleLogoFile(file);
                    }}
                  />
                </label>
                {logoError ? <div className={styles.errorText}>{logoError}</div> : null}
                <p className={styles.settingsHint}>PNG, JPEG, WebP or GIF, under 120KB.</p>
              </>
            ) : null}

            {tab === "keys" ? (
              <>
                <h2 className={styles.settingsPaneTitle}>API keys</h2>
                <p className={styles.settingsPaneDesc}>
                  {modeLabel} keys authenticate {networkIndex === 0 ? "Mainnet" : "Sepolia"} requests from your own
                  backend. They aren&apos;t required to use this dashboard — it works from your connected wallet alone.
                </p>

                <div className={styles.settingsField}>
                  <label className={styles.settingsLabel}>Public key</label>
                  {publicKey ? (
                    <div className={styles.secretField}>
                      <span className={styles.secretFieldValue}>{publicKey}</span>
                      <CopyButton value={publicKey} />
                    </div>
                  ) : (
                    <p className={styles.settingsHint} style={{ margin: 0 }}>Not generated yet.</p>
                  )}
                  <p className={styles.settingsHint}>Safe to embed in the checkout widget.</p>
                </div>

                {secretKey ? (
                  <div className={styles.settingsField}>
                    <label className={styles.settingsLabel}>Secret key</label>
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
                    <p className={styles.settingsHint}>
                      Bearer token for your server — never share it, never paste it into the dashboard.
                    </p>
                  </div>
                ) : null}

                {justIssued && secretKey ? (
                  <div className={styles.warn} style={{ marginBottom: 18 }}>
                    Save your secret key now — it won&apos;t be shown again after you leave this page.
                  </div>
                ) : null}

                <button className={styles.settingsBtn} disabled={issuing} onClick={issueKey}>
                  {issuing ? "Generating…" : publicKey ? "Rotate API key" : "Generate API key"}
                </button>
              </>
            ) : null}

            {tab === "webhook" ? (
              <>
                <h2 className={styles.settingsPaneTitle}>Webhook</h2>
                <p className={styles.settingsPaneDesc}>
                  POSTed the moment a Payment Link is paid, signed with HMAC-SHA256 using your secret key.
                </p>
                {secretKey ? (
                  <>
                    <div className={styles.settingsField}>
                      <label className={styles.settingsLabel} htmlFor="webhookUrl">
                        Endpoint URL
                      </label>
                      <input
                        id="webhookUrl"
                        className={styles.settingsInput}
                        placeholder="https://your-backend.example.com/webhooks/nomos"
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                      />
                      {webhookError ? <div className={styles.errorText}>{webhookError}</div> : null}
                      <p className={styles.settingsHint}>
                        Verify by computing <code>sha256(secret key)</code>, HMAC-ing the raw request body with it,
                        and comparing to <code>X-Nomos-Signature</code>.
                      </p>
                    </div>
                    <button className={styles.settingsBtn} disabled={savingWebhook} onClick={handleSaveWebhook}>
                      {savingWebhook ? "Saving…" : webhookSaved ? "Saved ✓" : "Save changes"}
                    </button>
                  </>
                ) : (
                  <p className={styles.settingsHint} style={{ margin: 0 }}>
                    Generate an API key first — webhooks are signed with your secret key.
                  </p>
                )}
              </>
            ) : null}

            {tab === "ips" ? (
              <>
                <h2 className={styles.settingsPaneTitle}>IP allowlist</h2>
                <p className={styles.settingsPaneDesc}>
                  Optional. Restrict your secret key to your server&apos;s IPs. Leave it empty to allow any IP — the
                  dashboard itself is never blocked by this.
                </p>
                {secretKey ? (
                  <>
                    <div className={styles.settingsField}>
                      <label className={styles.settingsLabel} htmlFor="ipDraft">
                        Allowed IPs
                      </label>
                      <input
                        id="ipDraft"
                        className={styles.settingsInput}
                        placeholder="e.g. 203.0.113.10 — press Enter to add"
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
                      {allowedIps.length ? (
                        <div className={styles.ipList}>
                          {allowedIps.map((ip) => (
                            <span key={ip} className={styles.ipChip}>
                              {ip}
                              <button
                                type="button"
                                aria-label={`Remove ${ip}`}
                                onClick={() => void saveIps(allowedIps.filter((x) => x !== ip))}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.settingsHint}>No IPs listed — any IP can use this key.</p>
                      )}
                    </div>
                    <button
                      className={styles.settingsBtn}
                      disabled={savingIps || !ipDraft.trim()}
                      onClick={() => void saveIps([...allowedIps, ipDraft])}
                    >
                      {savingIps ? "Saving…" : "Add IP"}
                    </button>
                  </>
                ) : (
                  <p className={styles.settingsHint} style={{ margin: 0 }}>
                    Generate an API key first — the allowlist restricts that key.
                  </p>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ProfileIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function BrandingIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8.5" cy="9.5" r="1.7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 17l5-4 4 3 3-2 4 3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function KeyIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <circle cx="8" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 12h9M18 12v3M15.5 12v2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function WebhookIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 5.5a3.5 3.5 0 0 1 5.6 4M6.5 16a3.5 3.5 0 0 1 1.4-6.6M17 10.5A3.5 3.5 0 0 1 17 17H10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
