"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "../../../uni.module.css";
import SelectWallet from "../WalletHandle/SelectWallet";
import { explorerTxUrl, fmtTokenAmount, shortHex } from "@/utils/receipt";
import { buildPaymentUrl } from "@/utils/payments";
import { tokenDecimals, type TokenSymbol } from "@/utils/constants";
import { TokenAmount } from "../../TokenIcons";
import { useMerchantAuth } from "./useMerchantAuth";
import { useLedger } from "./useLedger";
import { usePaymentLinks, expiresInLabel } from "./usePaymentLinks";
import { depositStatus, linkStatus, pillClass } from "./statusTone";
import { rowNavProps } from "./rowNav";
import ExternalIcon from "../../ExternalIcon";

// One Payment Link and everything recorded against it. Both the link and its
// deposits come from the lists the console already caches, so arriving here
// from the table paints immediately rather than re-fetching a single record.
export default function LinkDetailPanel({ id }: { id: string }) {
  const { isConnected, address, secretKey, networkIndex, sessionReady } = useMerchantAuth();
  const { links, loadError, refresh } = usePaymentLinks(address, secretKey, networkIndex, sessionReady);
  const { deposits } = useLedger(address, secretKey, networkIndex, sessionReady);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState("");

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

  const link = links?.find((l) => l.id === id) ?? null;

  if (links === null) {
    return (
      <div className={styles.consolePage}>
        <div className={styles.cPanel}>
          <div className={styles.cPanelSection}>
            <p className={styles.sectionSub}>Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!link) {
    return (
      <div className={styles.consolePage}>
        <div className={styles.cPanel}>
          <div className={styles.cPanelSection}>
            <div className={styles.breadcrumb}>
              <Link href="/create">Payment Links</Link>
              <span>›</span>
              <span>{id}</span>
            </div>
            <div className={styles.emptyBox} style={{ marginTop: 16 }}>
              <p>
                {loadError || "No Payment Link with this id on the current network. It may belong to your other mode — check the Test/Live switch."}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const url = buildPaymentUrl(typeof window !== "undefined" ? window.location.origin : "", link.id);
  const status = linkStatus(link);
  const decimals = tokenDecimals(link.token as TokenSymbol);
  // Deposits now record the link id directly; ref stays as the fallback for
  // rows written before that column existed.
  const paid = (deposits ?? []).filter((d) => (d.linkId ? d.linkId === link.id : d.ref === link.ref));

  async function handleRevoke() {
    setRevoking(true);
    setRevokeError("");
    try {
      const r = await fetch(`/api/payment-links/${id}`, {
        method: "DELETE",
        credentials: "include",
        headers: secretKey ? { Authorization: `Bearer ${secretKey}` } : {},
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? `HTTP ${r.status}`);
      refresh();
    } catch (e: unknown) {
      setRevokeError(e instanceof Error ? e.message : "Could not revoke this link.");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className={styles.consolePage}>
      <div className={styles.cPanel}>
        <div className={styles.detailLayout}>
          <div className={styles.detailMain}>
            <div className={styles.breadcrumb}>
              <Link href="/create">Payment Links</Link>
              <span>›</span>
              <span className={styles.cellMono}>{link.ref}</span>
            </div>
            <div className={styles.detailTitleRow}>
              <h1 className={styles.detailTitle}>{link.note ?? link.ref}</h1>
              <span className={pillClass(status.tone)}>{status.label}</span>
            </div>

            <h2 className={styles.detailSectionTitle}>Transactions</h2>
            {paid.length === 0 ? (
              <div className={styles.emptyBox}>
                <p>No payments yet. Deposits made through this link will appear here.</p>
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Flow</th>
                      <th>Recorded</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {paid.map((d) => {
                      const s = depositStatus(d.status);
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
                            <span className={pillClass(s.tone)}>{s.label}</span>
                          </td>
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
                              {shortHex(d.txHash)} <ExternalIcon />
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

          <aside className={styles.detailAside}>
            <h2 className={styles.asideTitle}>Payment link</h2>
            <div className={styles.copyField}>
              <a className={styles.copyFieldValue} href={url} target="_blank" rel="noreferrer" title={url}>
                {url}
              </a>
              <button
                type="button"
                className={styles.iconBtn}
                title="Copy link"
                onClick={() => {
                  navigator.clipboard.writeText(url).then(
                    () => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    },
                    () => {},
                  );
                }}
              >
                {copied ? "✓" : <CopyIcon />}
              </button>
            </div>

            <div className={styles.defRow}>
              <span className={styles.defLabel}>Token</span>
              <span className={styles.defValue}><TokenAmount symbol={link.token} /></span>
            </div>
            <div className={styles.defRow}>
              <span className={styles.defLabel}>Amount</span>
              <span className={styles.defValue}>
                {link.amountWei !== undefined ? (
                  <TokenAmount amount={fmtTokenAmount(BigInt(link.amountWei), decimals)} symbol={link.token} />
                ) : (
                  "Customer enters"
                )}
              </span>
            </div>
            <div className={styles.defRow}>
              <span className={styles.defLabel}>Description</span>
              <span className={styles.defValue}>{link.note ?? "—"}</span>
            </div>
            <div className={styles.defRow}>
              <span className={styles.defLabel}>Reference</span>
              <span className={`${styles.defValue} ${styles.cellMono}`} style={{ maxWidth: "none" }}>
                {link.ref}
              </span>
            </div>
            <div className={styles.defRow}>
              <span className={styles.defLabel}>Expires</span>
              <span className={styles.defValue}>{expiresInLabel(link) ?? status.label}</span>
            </div>
            <div className={styles.defRow}>
              <span className={styles.defLabel}>Created on</span>
              <span className={styles.defValue}>
                {new Date(link.createdAt * 1000).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
            <div className={styles.defRow}>
              <span className={styles.defLabel}>Received</span>
              <span className={styles.defValue}>
                {paid.length} payment{paid.length === 1 ? "" : "s"}
              </span>
            </div>

            {revokeError ? <div className={styles.errorText}>{revokeError}</div> : null}

            <div className={styles.detailActions}>
              <a className={styles.settingsBtn} href={url} target="_blank" rel="noreferrer">
                Open checkout <ExternalIcon />
              </a>
              {!link.revoked ? (
                <button
                  type="button"
                  className={`${styles.settingsBtn} ${styles.settingsBtnGhost}`}
                  disabled={revoking}
                  onClick={() => void handleRevoke()}
                >
                  {revoking ? "Revoking…" : "Revoke"}
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </div>
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
