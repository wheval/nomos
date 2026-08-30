"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "../../../uni.module.css";
import SelectWallet from "../WalletHandle/SelectWallet";
import { explorerTxUrl, fmtTokenAmount, shortHex } from "@/utils/receipt";
import { useMerchantAuth } from "./useMerchantAuth";
import { useLedger } from "./useLedger";
import { depositStatusLabel } from "./depositStatus";
import { usePaymentLinks, paymentLinkStatusLabel, expiresInLabel } from "./usePaymentLinks";
import { buildPaymentUrl } from "@/utils/payments";
import { TokenSymbols, tokenDecimals, type TokenSymbol } from "@/utils/constants";
import InsightsChart, { Donut, type ChartPoint } from "./InsightsChart";
import { rowNavProps } from "./rowNav";
import { TokenAmount, TokenLogo } from "../../TokenIcons";

const RANGES = [7, 30, 90] as const;
const DEFAULT_RANGE = 30;
const DAY = 86_400;

// Wei -> a plain number for charting/averaging only. Precision beyond a
// float is irrelevant at chart resolution; every figure the merchant acts
// on still renders through fmtTokenAmount off the original BigInt.
function toUnits(wei: string, decimals: number): number {
  return Number(wei) / 10 ** decimals;
}

function compact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function OverviewPanel() {
  const { isConnected, address, secretKey, networkIndex, sessionReady } = useMerchantAuth();
  const { deposits, balances, loadError } = useLedger(address, secretKey, networkIndex, sessionReady);
  const { links, loadError: linksLoadError } = usePaymentLinks(address, secretKey, networkIndex, sessionReady);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [days, setDays] = useState<number>(DEFAULT_RANGE);
  const [token, setToken] = useState<TokenSymbol>(TokenSymbols[0]);
  const router = useRouter();

  useEffect(() => {
    if (!address || !sessionReady) return;
    fetch(`/api/merchant-webhook?address=${address}&network=${networkIndex}`, {
      credentials: "include",
      headers: secretKey ? { Authorization: `Bearer ${secretKey}` } : {},
    })
      .then((r) => (r.ok ? r.json() : { webhookUrl: null }))
      .then((d) => setWebhookUrl(d.webhookUrl ?? ""))
      .catch(() => {});
  }, [address, secretKey, networkIndex, sessionReady]);

  const decimals = tokenDecimals(token);
  const since = Math.floor(Date.now() / 1000) - days * DAY;

  const inRange = useMemo(() => (deposits ?? []).filter((d) => d.recordedAt >= since), [deposits, since]);
  const forToken = useMemo(() => inRange.filter((d) => d.token === token), [inRange, token]);

  const volume = forToken.reduce((sum, d) => sum + toUnits(d.amountWei, decimals), 0);
  const avg = forToken.length ? volume / forToken.length : 0;

  // One bucket per day across the window, oldest first, so the series is
  // continuous even on days with no deposits.
  const startOfToday = new Date().setHours(0, 0, 0, 0) / 1000;
  const firstBucket = startOfToday - (days - 1) * DAY;
  const points: ChartPoint[] = Array.from({ length: days }, (_, i) => ({
    label: dayLabel((firstBucket + i * DAY) * 1000),
    value: forToken
      .filter((d) => Math.floor((d.recordedAt - firstBucket) / DAY) === i)
      .reduce((sum, d) => sum + toUnits(d.amountWei, decimals), 0),
  }));

  const settled = inRange.filter((d) => d.status === "verified" || d.status === "shielded").length;
  const settledRate = inRange.length ? (settled / inRange.length) * 100 : 0;
  const needsAttention = inRange.filter(
    (d) => d.status === "shield_failed" || d.status === "rejected" || d.status === "pending_verify" || d.status === "pending_shield",
  );
  const nowSec = Date.now() / 1000;
  const activeLinks = (links ?? []).filter((l) => !l.revoked && (l.expiresAt === undefined || l.expiresAt > nowSec));

  if (!isConnected) {
    return (
      <div className={styles.consolePage}>
        <div className={styles.cPanel}>
          <div className={styles.cPanelSection} style={{ textAlign: "center" }}>
            <p className={styles.sectionSub}>Connect the wallet your Payment Links pay into to see its console.</p>
            <SelectWallet variant="ctaBig" />
          </div>
        </div>
      </div>
    );
  }

  const recent = (deposits ?? []).slice(0, 5);
  const recentLinks = (links ?? []).slice(0, 5);

  return (
    <div className={styles.consolePage}>
      <div className={styles.cPanel}>
        <div className={styles.cPanelHead}>
          <span className={styles.cPanelTitle}>Insights</span>
        </div>

        <div className={styles.cPanelSection}>
          <div className={styles.filterRow}>
            <span className={styles.filterSelectWrap}>
              <CalendarIcon />
              <select
                className={`${styles.filterSelect} ${styles.filterSelectWithIcon}`}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                aria-label="Date range"
              >
                {RANGES.map((r) => (
                  <option key={r} value={r}>
                    Last {r} days
                  </option>
                ))}
              </select>
              <ChevronDownIcon />
            </span>

            {days !== DEFAULT_RANGE ? (
              <span className={`${styles.filterChip} ${styles.filterChipActive}`}>
                Date is Last {days} days
                <button
                  type="button"
                  className={styles.filterChipX}
                  onClick={() => setDays(DEFAULT_RANGE)}
                  aria-label="Reset date range"
                >
                  <CloseIcon />
                </button>
              </span>
            ) : null}

            <span className={styles.filterSpacer} />

            <span className={styles.filterSelectWrap}>
              <span className={styles.filterSelectIcon}>
                <TokenLogo symbol={token} size={15} />
              </span>
              <select
                className={`${styles.filterSelect} ${styles.filterSelectWithIcon}`}
                value={token}
                onChange={(e) => setToken(e.target.value as TokenSymbol)}
                aria-label="Token"
              >
                {TokenSymbols.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <ChevronDownIcon />
            </span>
          </div>
        </div>

        <div className={styles.cPanelSection}>
          <div className={styles.metricGrid}>
            <div className={styles.metricCard}>
              <div className={styles.metricLabel}>Volume</div>
              <div className={styles.metricValue}>
                <TokenAmount amount={compact(volume)} symbol={token} />
              </div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricLabel}>Balance</div>
              <div className={styles.metricValue}>
                <TokenAmount
                  amount={balances ? fmtTokenAmount(BigInt(balances[token]), decimals) : "—"}
                  symbol={token}
                />
              </div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricLabel}>Deposits</div>
              <div className={styles.metricValue}>{deposits ? forToken.length : "—"}</div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricLabel}>Avg. deposit value</div>
              <div className={styles.metricValue}>
                <TokenAmount amount={compact(avg)} symbol={token} />
              </div>
            </div>
          </div>
        </div>

        <div className={styles.cPanelSection}>
          <h2 className={styles.splitTitle}>Volume breakdown</h2>
          <InsightsChart points={points} unit="Volume" format={compact} />
        </div>

        <div className={styles.splitRow}>
          <div className={styles.splitCol}>
            <h2 className={styles.splitTitle}>Settled rate</h2>
            {inRange.length === 0 ? (
              <p className={styles.splitEmpty}>No deposits in this range yet.</p>
            ) : (
              <Donut percent={settledRate} />
            )}
          </div>
          <div className={styles.splitCol}>
            <h2 className={styles.splitTitle}>Needs attention</h2>
            {needsAttention.length === 0 ? (
              <p className={styles.splitEmpty}>Nothing pending or failed. Every deposit in this range cleared.</p>
            ) : (
              <>
                <div className={styles.metricValue} style={{ fontSize: 34 }}>
                  {needsAttention.length}
                </div>
                <p className={styles.splitEmpty} style={{ marginTop: 8 }}>
                  Deposit{needsAttention.length === 1 ? "" : "s"} still verifying, shielding, or rejected.
                </p>
              </>
            )}
          </div>
          <div className={styles.splitCol}>
            <h2 className={styles.splitTitle}>Active links</h2>
            <div className={styles.metricValue} style={{ fontSize: 34 }}>
              {links ? activeLinks.length : "—"}
            </div>
            <p className={styles.splitEmpty} style={{ marginTop: 8 }}>
              {webhookUrl ? "Webhook is delivering events." : "No webhook set — events aren't being delivered."}
            </p>
          </div>
        </div>
      </div>

      <div className={styles.cPanel}>
        <div className={styles.cPanelHead}>
          <span className={styles.cPanelTitle}>Recent activity</span>
          <Link href="/dashboard/transactions" className={styles.cPanelLink}>
            View all →
          </Link>
        </div>

        <div className={styles.cPanelSection}>
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
                  <div key={d.id} {...rowNavProps(router, `/dashboard/transactions/${d.id}`, styles.txRow)}>
                    <div className={styles.txMain}>
                      <div className={styles.txTitle}>
                        <Link href={`/dashboard/transactions/${d.id}`} className={styles.rowTitleLink}>
                          {d.note ?? d.ref ?? "Payment"}
                        </Link>
                        {badge ? <span className={styles.keyBadge} style={{ marginLeft: 8 }}>{badge}</span> : null}
                      </div>
                      <div className={styles.txTime}>{new Date(d.recordedAt * 1000).toLocaleString()}</div>
                    </div>
                    <div className={styles.txAmount}>
                      <TokenAmount
                        amount={fmtTokenAmount(BigInt(d.amountWei), tokenDecimals(d.token as TokenSymbol))}
                        symbol={d.token}
                      />
                    </div>
                    <a
                      className={styles.txLink}
                      href={explorerTxUrl(networkIndex, d.txHash)}
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

      <div className={styles.cPanel}>
        <div className={styles.cPanelHead}>
          <span className={styles.cPanelTitle}>Recent Payment Links</span>
          <Link href="/create" className={styles.cPanelLink}>
            Create a link →
          </Link>
        </div>

        <div className={styles.cPanelSection}>
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
                  <div key={l.id} {...rowNavProps(router, `/dashboard/links/${l.id}`, styles.txRow)}>
                    <div className={styles.txMain}>
                      <div className={styles.txTitle}>
                        <Link href={`/dashboard/links/${l.id}`} className={styles.rowTitleLink}>
                          {l.note ?? l.ref}
                        </Link>
                        {badge ? <span className={styles.keyBadge} style={{ marginLeft: 8 }}>{badge}</span> : null}
                      </div>
                      <div className={styles.txTime}>{new Date(l.createdAt * 1000).toLocaleString()}</div>
                      {expiry ? <div className={styles.txExpiry}>{expiry}</div> : null}
                    </div>
                    <div className={styles.txAmount}>
                      {l.amountWei !== undefined ? (
                        <TokenAmount
                          amount={fmtTokenAmount(BigInt(l.amountWei), tokenDecimals(l.token as TokenSymbol))}
                          symbol={l.token}
                        />
                      ) : (
                        "Open"
                      )}
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
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg className={styles.filterSelectIcon} width="15" height="15" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
