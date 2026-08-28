"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "../../../uni.module.css";
import SelectWallet from "../WalletHandle/SelectWallet";
import { explorerTxUrl, fmtTokenAmount, shortHex } from "@/utils/receipt";
import { useMerchantAuth } from "./useMerchantAuth";
import { useLedger } from "./useLedger";
import { depositStatusLabel } from "./depositStatus";
import { usePaymentLinks, paymentLinkStatusLabel, expiresInLabel } from "./usePaymentLinks";
import { buildPaymentUrl } from "@/utils/payments";
import { TokenSymbols, tokenDecimals } from "@/utils/constants";

export default function OverviewPanel() {
  const { isConnected, address, secretKey, networkIndex, sessionReady } = useMerchantAuth();
  const { deposits, balances, loadError } = useLedger(address, secretKey, networkIndex, sessionReady);
  const { links, loadError: linksLoadError } = usePaymentLinks(address, secretKey, networkIndex, sessionReady);
  const myFrontendProviderIndex = networkIndex;
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    if (!address || !sessionReady) return;
    fetch(`/api/merchant-webhook?address=${address}&network=${networkIndex}`, { credentials: "include", headers: secretKey ? { Authorization: `Bearer ${secretKey}` } : {} })
      .then((r) => (r.ok ? r.json() : { webhookUrl: null }))
      .then((d) => setWebhookUrl(d.webhookUrl ?? ""))
      .catch(() => {});
  }, [address, secretKey, networkIndex, sessionReady]);

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

  const recent = (deposits ?? []).slice(0, 5);
  const recentLinks = (links ?? []).slice(0, 5);

  return (
    <div className={styles.consolePage}>
      <div className={styles.consoleHead}>
        <h1 className={styles.consoleTitle}>Overview</h1>
        <p className={styles.consoleSub}>What&apos;s landed, at a glance.</p>
      </div>

      <div className={styles.statGrid}>
        {TokenSymbols.map((t) => (
          <div key={t} className={styles.statCard}>
            <div className={styles.statLabel}>{t} Balance</div>
            <div className={styles.statValue}>
              {balances ? fmtTokenAmount(BigInt(balances[t]), tokenDecimals(t)) : "—"} <span>{t}</span>
            </div>
          </div>
        ))}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Deposits</div>
          <div className={styles.statValue}>{deposits ? deposits.length : "—"}</div>
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
          <span className={styles.sectionTitle}>Recent activity</span>
          <Link href="/dashboard/transactions" className={styles.consoleSub} style={{ color: "var(--pink-text)" }}>
            View all →
          </Link>
        </div>

        {loadError ? (
          <div className={styles.errorText}>{loadError}</div>
        ) : deposits === null ? (
          <p className={styles.sectionSub}>Loading…</p>
        ) : recent.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No deposits recorded yet — they&apos;ll appear here as your Payment Links get paid.</p>
            <div className={styles.nextSteps} style={{ maxWidth: 260, margin: "0 auto" }}>
              <Link href="/create">Create a Payment Link →</Link>
            </div>
          </div>
        ) : (
          <div className={styles.txTable}>
            {recent.map((d) => {
              const badge = depositStatusLabel(d.status);
              return (
                <div key={d.id} className={styles.txRow}>
                  <div className={styles.txMain}>
                    <div className={styles.txTitle}>
                      {d.note ?? d.ref ?? "Payment"}
                      {badge ? <span className={styles.keyBadge} style={{ marginLeft: 8 }}>{badge}</span> : null}
                    </div>
                    <div className={styles.txTime}>{new Date(d.recordedAt * 1000).toLocaleString()}</div>
                  </div>
                  <div className={styles.txAmount}>
                    {fmtTokenAmount(BigInt(d.amountWei), tokenDecimals(d.token as "STRK" | "USDC"))} {d.token}
                  </div>
                  <a
                    className={styles.txLink}
                    href={explorerTxUrl(myFrontendProviderIndex, d.txHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortHex(d.txHash)} ↗
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.sectionCard}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Recent Payment Links</span>
          <Link href="/create" className={styles.consoleSub} style={{ color: "var(--pink-text)" }}>
            Create a link →
          </Link>
        </div>

        {linksLoadError ? (
          <div className={styles.errorText}>{linksLoadError}</div>
        ) : links === null ? (
          <p className={styles.sectionSub}>Loading…</p>
        ) : recentLinks.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No Payment Links yet.</p>
            <div className={styles.nextSteps} style={{ maxWidth: 260, margin: "0 auto" }}>
              <Link href="/create">Create a Payment Link →</Link>
            </div>
          </div>
        ) : (
          <div className={styles.txTable}>
            {recentLinks.map((l) => {
              const badge = paymentLinkStatusLabel(l);
              const url = buildPaymentUrl(typeof window !== "undefined" ? window.location.origin : "", l.id);
              const expiry = expiresInLabel(l);
              return (
                <div key={l.id} className={styles.txRow}>
                  <div className={styles.txMain}>
                    <div className={styles.txTitle}>
                      {l.note ?? l.ref}
                      {badge ? <span className={styles.keyBadge} style={{ marginLeft: 8 }}>{badge}</span> : null}
                    </div>
                    <div className={styles.txTime}>{new Date(l.createdAt * 1000).toLocaleString()}</div>
                    {expiry ? <div className={styles.txExpiry}>{expiry}</div> : null}
                  </div>
                  <div className={styles.txAmount}>
                    {l.amountWei !== undefined
                      ? `${fmtTokenAmount(BigInt(l.amountWei), tokenDecimals(l.token as "STRK" | "USDC"))} ${l.token}`
                      : "Open"}
                  </div>
                  <div className={styles.txActions}>
                    <a className={styles.txLink} href={url} target="_blank" rel="noreferrer" title="Open link">
                      View ↗
                    </a>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(url).catch(() => {})}
                      title="Copy link"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
