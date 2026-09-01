"use client";

import styles from "../../../uni.module.css";
import SelectWallet from "../WalletHandle/SelectWallet";
import { useMerchantAuth } from "./useMerchantAuth";
import { useLedger } from "./useLedger";
import Payout from "./Payout";

export default function PayoutsPanel() {
  const { isConnected, address, secretKey, networkIndex, sessionReady } = useMerchantAuth();
  const { balances, loadError, refresh } = useLedger(address, secretKey, networkIndex, sessionReady);

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

  return (
    <div className={styles.consolePage}>
      {loadError ? (
        <div className={styles.cPanel}>
          <div className={styles.cPanelSection}>
            <p className={styles.errorText}>{loadError}</p>
          </div>
        </div>
      ) : balances === null ? (
        <div className={styles.cPanel}>
          <div className={styles.cPanelSection}>
            <p className={styles.sectionSub}>Loading balance…</p>
          </div>
        </div>
      ) : (
        <Payout merchantAddress={address} secretKey={secretKey} balances={balances} onPaidOut={refresh} />
      )}
    </div>
  );
}
