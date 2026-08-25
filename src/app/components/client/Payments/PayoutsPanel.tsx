"use client";

import styles from "../../../uni.module.css";
import SelectWallet from "../WalletHandle/SelectWallet";
import { useMerchantAuth } from "./useMerchantAuth";
import { useLedger } from "./useLedger";
import Payout from "./Payout";

export default function PayoutsPanel() {
  const { isConnected, address, secretKey } = useMerchantAuth();
  const { balances, refresh } = useLedger(address, secretKey);

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
        <h1 className={styles.consoleTitle}>Payouts</h1>
        <p className={styles.consoleSub}>Withdraw from your balance, publicly or privately.</p>
      </div>

      {!secretKey || balances === null ? (
        <div className={styles.sectionCard}>
          <p className={styles.sectionSub}>Generate an API key in Settings first to see your balance.</p>
        </div>
      ) : (
        <Payout merchantAddress={address} secretKey={secretKey} balances={balances} onPaidOut={refresh} />
      )}
    </div>
  );
}
