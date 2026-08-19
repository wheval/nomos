"use client";

import { Suspense } from "react";
import styles from "../uni.module.css";
import SelectWallet from "../components/client/WalletHandle/SelectWallet";
import Checkout from "../components/client/Payments/Checkout";
import Brand from "../components/Brand";

export default function PayPage() {
  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <Brand />
        <SelectWallet variant="nav" />
      </nav>

      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>
          Just Encrypt
          <br />
          <span className={styles.heroAccent}>the Payment</span>
        </h1>
        <p className={styles.heroSub}>
          Your identity and the amount never touch a public ledger.
        </p>
      </header>

      <main>
        {/* useSearchParams requires a Suspense boundary in the App Router. */}
        <Suspense fallback={<div className={styles.panel} />}>
          <Checkout />
        </Suspense>
      </main>

      <footer className={styles.footer}>
        <span>Nomos</span>
        <span className={styles.footerDot}>·</span>
        <span>Powered by STRK20</span>
      </footer>
    </div>
  );
}
