"use client";

import Link from "next/link";
import styles from "../uni.module.css";
import SelectWallet from "../components/client/WalletHandle/SelectWallet";
import Dashboard from "../components/client/Payments/Dashboard";

export default function DashboardPage() {
  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tokens/strk20.png" alt="STRK20" className={styles.brandImg} />
        </div>
        <SelectWallet variant="nav" />
      </nav>

      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>
          Your
          <br />
          <span className={styles.heroAccent}>dashboard</span>
        </h1>
        <p className={styles.heroSub}>
          What's landed, and the key your own backend can use to check.
        </p>
      </header>

      <main>
        <Dashboard />
      </main>

      <footer className={styles.footer}>
        <Link href="/create">Create a link</Link>
        <span className={styles.footerDot}>·</span>
        <span>Nomos</span>
      </footer>
    </div>
  );
}
