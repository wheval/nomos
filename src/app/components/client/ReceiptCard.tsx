"use client";

import styles from "../../uni.module.css";
import type { ActionResult } from "@/utils/receipt";
import { explorerTxUrl } from "@/utils/receipt";

// Readable receipt card for a submitted STRK20 action - replaces raw JSON/hex.
// Shared between the wallet panel and the Payment Link checkout flow.
export default function ReceiptCard({
  result,
  providerIndex,
}: {
  result: ActionResult;
  providerIndex: number;
}) {
  const r = result;
  return (
    <div
      className={`${styles.receipt} ${
        r.status === "error"
          ? styles.receiptError
          : r.status === "pending"
          ? styles.receiptPending
          : styles.receiptOk
      }`}
    >
      <div className={styles.receiptHead}>
        <span className={styles.receiptIcon}>
          {r.status === "ok" ? "✓" : r.status === "error" ? "!" : "⋯"}
        </span>
        <span>{r.title}</span>
      </div>
      {r.rows?.length ? (
        <div className={styles.receiptRows}>
          {r.rows.map((row) => (
            <div key={row.label} className={styles.receiptRow}>
              <span className={styles.receiptLabel}>{row.label}</span>
              {row.hash ? (
                <a
                  className={styles.receiptLink}
                  href={explorerTxUrl(providerIndex, row.hash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {row.value} ↗
                </a>
              ) : (
                <span className={styles.receiptValue}>{row.value}</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {r.note ? <pre className={styles.receiptNote}>{r.note}</pre> : null}
    </div>
  );
}
