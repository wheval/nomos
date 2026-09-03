"use client";

import Link from "next/link";
import styles from "../../../uni.module.css";
import SelectWallet from "../WalletHandle/SelectWallet";
import { explorerTxUrl, fmtTokenAmount, shortHex, isOnChainHash } from "@/utils/receipt";
import { buildPaymentUrl } from "@/utils/payments";
import { tokenDecimals, type TokenSymbol } from "@/utils/constants";
import { TokenAmount } from "../../TokenIcons";
import { useMerchantAuth } from "./useMerchantAuth";
import { useLedger } from "./useLedger";
import { usePaymentLinks } from "./usePaymentLinks";
import { depositStatus, pillClass } from "./statusTone";

// One deposit and the link it came from. Like the link detail view, both
// records are read out of the console's cached lists, so opening a row from
// the table renders straight away.
export default function TransactionDetailPanel({ id }: { id: string }) {
  const { isConnected, address, secretKey, networkIndex, sessionReady } = useMerchantAuth();
  const { deposits, loadError } = useLedger(address, secretKey, networkIndex, sessionReady);
  const { links } = usePaymentLinks(address, secretKey, networkIndex, sessionReady);

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

  if (deposits === null) {
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

  const deposit = deposits.find((d) => d.id === id) ?? null;

  if (!deposit) {
    return (
      <div className={styles.consolePage}>
        <div className={styles.cPanel}>
          <div className={styles.cPanelSection}>
            <div className={styles.breadcrumb}>
              <Link href="/dashboard/transactions">Transactions</Link>
              <span>›</span>
              <span>{id}</span>
            </div>
            <div className={styles.emptyBox} style={{ marginTop: 16 }}>
              <p>
                {loadError || "No transaction with this id on the current network. It may belong to your other mode — check the Test/Live switch."}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const status = depositStatus(deposit.status);
  const decimals = tokenDecimals(deposit.token as TokenSymbol);
  // Absent on transactions recorded before pricing existed — those were
  // credited in full, so 0 is the accurate history, not a default.
  const feeWei = BigInt(deposit.feeWei ?? "0");
  // linkId is authoritative; ref is the fallback for deposits recorded before
  // the link id was stored on them.
  const link =
    (deposit.linkId ? (links ?? []).find((l) => l.id === deposit.linkId) : undefined) ??
    (deposit.ref ? (links ?? []).find((l) => l.ref === deposit.ref) : undefined) ??
    null;

  return (
    <div className={styles.consolePage}>
      <div className={styles.cPanel}>
        <div className={styles.detailLayout}>
          <div className={styles.detailMain}>
            <div className={styles.breadcrumb}>
              <Link href="/dashboard/transactions">Transactions</Link>
              <span>›</span>
              <span className={styles.cellMono}>{deposit.ref ?? shortHex(deposit.txHash)}</span>
            </div>
            <div className={styles.detailTitleRow}>
              <h1 className={styles.detailTitle}>
                <TokenAmount
                  amount={fmtTokenAmount(BigInt(deposit.amountWei), decimals)}
                  symbol={deposit.token}
                  size={24}
                />
              </h1>
              <span className={pillClass(status.tone)}>{status.label}</span>
            </div>
            {deposit.note ? <p className={styles.pageHeadSub}>{deposit.note}</p> : null}

            <h2 className={styles.detailSectionTitle}>Payment link</h2>
            {link ? (
              <div className={styles.tableWrap}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Reference</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <Link href={`/dashboard/links/${link.id}`} className={styles.rowTitleLink}>
                          {link.note ?? link.ref}
                        </Link>
                      </td>
                      <td className={styles.cellMono}>{link.ref}</td>
                      <td className={styles.cellMuted}>{new Date(link.createdAt * 1000).toLocaleDateString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.emptyBox}>
                <p>
                  {deposit.ref
                    ? "The Payment Link for this deposit is no longer on record."
                    : "This deposit was made without a Payment Link — paid straight to your address."}
                </p>
              </div>
            )}
          </div>

          <aside className={styles.detailAside}>
            <h2 className={styles.asideTitle}>Transaction</h2>
            <div className={styles.copyField}>
              {/* A payment reconciled from a shielded note has no transaction
                  hash to link to — the note is the evidence. Rendering it as a
                  link would send the merchant to a dead explorer page. */}
              {!isOnChainHash(deposit.txHash) ? (
                <span className={styles.copyFieldValue} title={deposit.txHash}>
                  Settled from a shielded note
                </span>
              ) : (
              <a
                className={styles.copyFieldValue}
                href={explorerTxUrl(networkIndex, deposit.txHash)}
                target="_blank"
                rel="noreferrer"
                title={deposit.txHash}
              >
                {shortHex(deposit.txHash)} ↗
              </a>
              )}
            </div>

            <div className={styles.defRow}>
              <span className={styles.defLabel}>Amount</span>
              <span className={styles.defValue}>
                <TokenAmount
                  amount={fmtTokenAmount(BigInt(deposit.amountWei), decimals)}
                  symbol={deposit.token}
                />
              </span>
            </div>
            {/* Only shown when a fee was actually charged: transactions that
                settled before pricing existed carry none, and a "0.00 fee"
                row on those is noise rather than information. */}
            {feeWei > 0n ? (
              <>
                <div className={styles.defRow}>
                  <span className={styles.defLabel}>Nomos fee</span>
                  <span className={styles.defValue}>
                    <TokenAmount amount={fmtTokenAmount(feeWei, decimals)} symbol={deposit.token} />
                  </span>
                </div>
                <div className={styles.defRow}>
                  <span className={styles.defLabel}>Credited to you</span>
                  <span className={styles.defValue}>
                    <TokenAmount
                      amount={fmtTokenAmount(BigInt(deposit.amountWei) - feeWei, decimals)}
                      symbol={deposit.token}
                    />
                  </span>
                </div>
              </>
            ) : null}
            <div className={styles.defRow}>
              <span className={styles.defLabel}>Status</span>
              <span className={styles.defValue}>
                <span className={pillClass(status.tone)}>{status.label}</span>
              </span>
            </div>
            <div className={styles.defRow}>
              <span className={styles.defLabel}>Flow</span>
              <span className={styles.defValue}>
                {deposit.flow === "A" ? "Private (shielded transfer)" : "Public (ordinary transfer)"}
              </span>
            </div>
            <div className={styles.defRow}>
              <span className={styles.defLabel}>Description</span>
              <span className={styles.defValue}>{deposit.note ?? "—"}</span>
            </div>
            <div className={styles.defRow}>
              <span className={styles.defLabel}>Reference</span>
              <span className={`${styles.defValue} ${styles.cellMono}`} style={{ maxWidth: "none" }}>
                {deposit.reference}
              </span>
            </div>
            <div className={styles.defRow}>
              <span className={styles.defLabel}>Link ref</span>
              <span className={`${styles.defValue} ${styles.cellMono}`} style={{ maxWidth: "none" }}>
                {deposit.ref ?? "—"}
              </span>
            </div>
            <div className={styles.defRow}>
              <span className={styles.defLabel}>Recorded</span>
              <span className={styles.defValue}>{new Date(deposit.recordedAt * 1000).toLocaleString()}</span>
            </div>
            {deposit.shieldTxHash ? (
              <div className={styles.defRow}>
                <span className={styles.defLabel}>Shield tx</span>
                <span className={styles.defValue}>
                  <a
                    className={styles.txLink}
                    href={explorerTxUrl(networkIndex, deposit.shieldTxHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortHex(deposit.shieldTxHash)} ↗
                  </a>
                </span>
              </div>
            ) : null}

            <div className={styles.detailActions}>
              {isOnChainHash(deposit.txHash) ? (
                <a
                  className={styles.settingsBtn}
                  href={explorerTxUrl(networkIndex, deposit.txHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on explorer ↗
                </a>
              ) : null}
              {link ? (
                <Link
                  href={buildPaymentUrl(typeof window !== "undefined" ? window.location.origin : "", link.id)}
                  className={`${styles.settingsBtn} ${styles.settingsBtnGhost}`}
                  target="_blank"
                >
                  Open checkout ↗
                </Link>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
