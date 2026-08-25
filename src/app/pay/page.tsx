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

      <main style={{ paddingTop: 28 }}>
        {/* useSearchParams requires a Suspense boundary in the App Router. */}
        <Suspense fallback={<div className={styles.panel} />}>
          <Checkout />
        </Suspense>
      </main>

      <Footer />
    </div>
  );
}
