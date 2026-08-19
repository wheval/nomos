"use client";

import { Suspense } from "react";
import styles from "../uni.module.css";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import Checkout from "../components/client/Payments/Checkout";

export default function PayPage() {
  return (
    <div className={styles.page}>
      <Nav variant="customer" />

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

      <Footer />
    </div>
  );
}
