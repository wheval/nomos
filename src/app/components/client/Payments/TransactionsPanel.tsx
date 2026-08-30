"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "../../../uni.module.css";
import SelectWallet from "../WalletHandle/SelectWallet";
import { explorerTxUrl, fmtTokenAmount, shortHex } from "@/utils/receipt";
import { useMerchantAuth } from "./useMerchantAuth";
import { useLedger } from "./useLedger";
import { depositStatus, pillClass } from "./statusTone";
import { rowNavProps } from "./rowNav";
import { tokenDecimals, type TokenSymbol } from "@/utils/constants";
import { TokenAmount } from "../../TokenIcons";

const RANGES = [
  { days: 0, label: "All time" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
] as const;

export default function TransactionsPanel() {
  const { isConnected, address, secretKey, networkIndex, sessionReady } = useMerchantAuth();
  const { deposits, loadError } = useLedger(address, secretKey, networkIndex, sessionReady);
  const [days, setDays] = useState(0);
  const router = useRouter();

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

  const since = days === 0 ? 0 : Date.now() / 1000 - days * 86_400;
  const rows = (deposits ?? []).filter((d) => d.recordedAt >= since);

  return (
    <div className={styles.consolePage}>
      <div className={styles.cPanel}>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.pageHeadTitle}>Transactions</h1>
            <p className={styles.pageHeadSub}>Every deposit recorded against your Payment Links.</p>
          </div>
          <div className={styles.pageHeadActions}>
            <span className={styles.filterSelectWrap}>
              <CalendarIcon />
              <select
                className={`${styles.filterSelect} ${styles.filterSelectWithIcon}`}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                aria-label="Date range"
              >
                {RANGES.map((r) => (
                  <option key={r.days} value={r.days}>
                    {r.label}
                  </option>
                ))}
              </select>
              <ChevronDownIcon />
            </span>
          </div>
        </div>

        <div className={styles.pageBody}>
          {loadError ? (
            <div className={styles.errorText}>{loadError}</div>
          ) : deposits === null ? (
            <div className={styles.emptyBox}>
              <p>Loading…</p>
            </div>
          ) : rows.length === 0 ? (
            <div className={styles.emptyBox}>
              <p>
                {deposits.length === 0
                  ? "No deposits recorded yet — they'll appear here as your Payment Links get paid."
                  : "No deposits in this date range."}
              </p>
              {deposits.length === 0 ? (
                <div className={styles.nextSteps} style={{ maxWidth: 260, marginTop: 16 }}>
                  <Link href="/create">Create a Payment Link →</Link>
                </div>
              ) : null}
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Description</th>
                    <th>Reference</th>
                    <th>Link ref</th>
                    <th>Flow</th>
                    <th>Recorded</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => {
                    const status = depositStatus(d.status);
                    return (
                      <tr key={d.id} {...rowNavProps(router, `/dashboard/transactions/${d.id}`)}>
                        <td className={styles.cellStrong}>
                          <Link href={`/dashboard/transactions/${d.id}`} className={styles.rowTitleLink}>
                            <TokenAmount
                              amount={fmtTokenAmount(BigInt(d.amountWei), tokenDecimals(d.token as TokenSymbol))}
                              symbol={d.token}
                            />
                          </Link>
                        </td>
                        <td>
                          <span className={pillClass(status.tone)}>{status.label}</span>
                        </td>
                        <td>{d.note ?? "—"}</td>
                        <td className={styles.cellMono}>{d.reference}</td>
                        <td className={styles.cellMono}>{d.ref ?? "—"}</td>
                        <td>
                          <span className={styles.cellChip}>{d.flow === "A" ? "Private" : "Public"}</span>
                        </td>
                        <td className={styles.cellMuted}>{new Date(d.recordedAt * 1000).toLocaleString()}</td>
                        <td>
                          <a
                            className={styles.txLink}
                            href={explorerTxUrl(networkIndex, d.txHash)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shortHex(d.txHash)} ↗
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
