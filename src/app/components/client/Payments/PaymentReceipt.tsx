"use client";

import { explorerTxUrl, isOnChainHash, shortHex } from "@/utils/receipt";
import styles from "../../../uni.module.css";
import { TokenLogo } from "../../TokenIcons";
import ExternalIcon from "../../ExternalIcon";

// What a payer gets to keep. Until now the paid state was a success card and a
// return link — nothing they could file, forward to an accountant, or quote
// back to the business three weeks later.
//
// Downloading is print-to-PDF rather than a generated file: the browser
// already renders this exactly right, every platform can save the dialog's
// output, and it avoids shipping a PDF library to every checkout page for one
// button. The print stylesheet hides the rest of the page.
export default function PaymentReceipt({
  merchantName,
  logoDataUrl,
  amount,
  token,
  reference,
  txHash,
  flow,
  networkIndex,
  paidAt,
}: {
  merchantName: string | null;
  logoDataUrl?: string;
  amount: string;
  token: string;
  reference: string | null;
  txHash: string | null;
  flow: "A" | "B";
  networkIndex: number;
  paidAt: number;
}) {
  const onChain = isOnChainHash(txHash);

  return (
    <div className={styles.payReceipt} id="nomos-receipt">
      <div className={styles.payReceiptBand} />

      {/* The reference always carries a mark at the top, straddling the band.
          A merchant without a logo falls back to their initial rather than
          leaving a hole where the identity should be. */}
      {logoDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.payReceiptLogo} src={logoDataUrl} alt="" />
      ) : (
        <div className={styles.payReceiptLogo} aria-hidden="true">
          <span className={styles.payReceiptLogoLetter}>
            {(merchantName ?? "?").trim().charAt(0).toUpperCase()}
          </span>
        </div>
      )}

      <div className={styles.payReceiptFrom}>
        Receipt from <b>{merchantName ?? "this business"}</b>
      </div>
      <div className={styles.payReceiptDate}>
        {new Date(paidAt * 1000).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </div>

      <div className={styles.payReceiptAmountLabel}>Amount paid</div>
      <div className={styles.payReceiptAmount}>
        <TokenLogo symbol={token} size={22} />
        {amount}
        <span>{token}</span>
      </div>

      <div className={styles.payReceiptRule} />

      {reference ? (
        <div className={styles.payReceiptStack}>
          <div className={styles.payReceiptStackLabel}>Payment reference</div>
          <div className={styles.payReceiptStackValue}>{reference}</div>
        </div>
      ) : null}

      <div className={styles.payReceiptRow}>
        <span className={styles.payReceiptRowLabel}>Transaction</span>
        <span className={styles.payReceiptRowValue}>
          {/* A payment settled from a shielded note has no hash to link. */}
          {onChain && txHash ? (
            <a href={explorerTxUrl(networkIndex, txHash)} target="_blank" rel="noreferrer">
              {shortHex(txHash)} <ExternalIcon />
            </a>
          ) : (
            "Settled privately"
          )}
        </span>
      </div>

      <div className={styles.payReceiptRow}>
        <span className={styles.payReceiptRowLabel}>Payment method</span>
        <span className={styles.payReceiptRowValue}>
          <TokenLogo symbol={token} size={14} />
          {token} · {flow === "A" ? "private" : "standard"}
        </span>
      </div>

      <button
        type="button"
        className={styles.payReceiptDownload}
        data-print-hide
        onClick={() => window.print()}
      >
        Download receipt
      </button>
    </div>
  );
}
