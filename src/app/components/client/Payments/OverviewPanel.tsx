"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "../../../uni.module.css";
import SelectWallet from "../WalletHandle/SelectWallet";
import { explorerTxUrl, fmtStrk, shortHex } from "@/utils/receipt";
import { useFrontendProvider } from "../provider/providerContext";
import { useMerchantAuth } from "./useMerchantAuth";
import { useLedger } from "./useLedger";
import { depositStatusLabel } from "./depositStatus";

export default function OverviewPanel() {
  const { isConnected, address, secretKey } = useMerchantAuth();
  const { deposits, balanceWei, loadError } = useLedger(address, secretKey);
  const myFrontendProviderIndex = useFrontendProvider((state) => state.currentFrontendProviderIndex);
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    if (!address || !secretKey) return;
    fetch(`/api/merchant-webhook?address=${address}`, { headers: { Authorization: `Bearer ${secretKey}` } })
      .then((r) => (r.ok ? r.json() : { webhookUrl: null }))
      .then((d) => setWebhookUrl(d.webhookUrl ?? ""))
      .catch(() => {});
  }, [address, secretKey]);

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

  return (
    <div className={styles.consolePage}>
      <div className={styles.consoleHead}>
        <h1 className={styles.consoleTitle}>Overview</h1>
        <p className={styles.consoleSub}>What&apos;s landed, at a glance.</p>
      </div>

      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Balance</div>
          <div className={styles.statValue}>
            {balanceWei !== null ? fmtStrk(BigInt(balanceWei)) : "—"} <span>STRK</span>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Deposits</div>
          <div className={styles.statValue}>{deposits ? deposits.length : "—"}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Webhook</div>
          <div className={styles.statValue} style={{ fontSize: 16 }}>
            {webhookUrl ? (
              <span style={{ color: "var(--c-green)" }}>● Active</span>
            ) : (
              <span style={{ color: "var(--c-muted-2)" }}>Not set</span>
            )}
          </div>
        </div>
      </div>

      <div className={styles.sectionCard}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Recent activity</span>
          <Link href="/dashboard/transactions" className={styles.consoleSub} style={{ color: "var(--c-accent)" }}>
            View all →
          </Link>
        </div>

        {!secretKey ? (
          <div className={styles.emptyState}>
            <p>Generate an API key in Settings to unlock this list.</p>
            <Link href="/dashboard/settings" className={styles.consoleSub} style={{ color: "var(--c-accent)" }}>
              Go to Settings →
            </Link>
          </div>
        ) : loadError ? (
          <div className={styles.errorText}>{loadError}</div>
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
                  <div className={styles.txAmount}>{fmtStrk(BigInt(d.amountWei))} STRK</div>
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
    </div>
  );
}
