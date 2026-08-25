"use client";

import Link from "next/link";
import styles from "../../../uni.module.css";
import SelectWallet from "../WalletHandle/SelectWallet";
import { explorerTxUrl, fmtTokenAmount, shortHex } from "@/utils/receipt";
import { useFrontendProvider } from "../provider/providerContext";
import { useMerchantAuth } from "./useMerchantAuth";
import { useLedger } from "./useLedger";
import { depositStatusLabel } from "./depositStatus";
import { tokenDecimals } from "@/utils/constants";

export default function TransactionsPanel() {
  const { isConnected, address, secretKey } = useMerchantAuth();
  const { deposits, loadError } = useLedger(address, secretKey);
  const myFrontendProviderIndex = useFrontendProvider((state) => state.currentFrontendProviderIndex);

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

  return (
    <div className={styles.consolePage}>
      <div className={styles.consoleHead}>
        <h1 className={styles.consoleTitle}>Transactions</h1>
        <p className={styles.consoleSub}>Every deposit recorded against your Payment Links.</p>
      </div>

      <div className={styles.sectionCard}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Deposits</span>
          {deposits?.length ? <span className={styles.sectionMeta}>{deposits.length} total</span> : null}
        </div>

        {!secretKey ? (
          <div className={styles.emptyState}>
            <p>Generate an API key in Settings to unlock this list.</p>
          </div>
        ) : loadError ? (
          <div className={styles.errorText}>{loadError}</div>
        ) : deposits && deposits.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No deposits recorded yet — they&apos;ll appear here as your Payment Links get paid.</p>
            <div className={styles.nextSteps} style={{ maxWidth: 260, margin: "0 auto" }}>
              <Link href="/create">Create a Payment Link →</Link>
            </div>
          </div>
        ) : deposits ? (
          <div className={styles.txTable}>
            {deposits.map((d) => {
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
        ) : null}
      </div>
    </div>
  );
}
