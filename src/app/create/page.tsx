"use client";

import Link from "next/link";
import styles from "../uni.module.css";
import SelectWallet from "../components/client/WalletHandle/SelectWallet";
import CreateLink from "../components/client/Payments/CreateLink";
import Brand from "../components/Brand";

export default function CreatePage() {
  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <Brand />
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <Link href="/dashboard" className={styles.navLink}>Dashboard</Link>
          <SelectWallet variant="nav" />
        </div>
      </nav>

      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>
          Get paid,
          <br />
          <span className={styles.heroAccent}>privately</span>
        </h1>
        <p className={styles.heroSub}>
          Generate a Payment Link. Whoever pays it, the amount and their
          identity stay shielded in the STRK20 pool.
        </p>
      </header>

      <main>
        <CreateLink />
      </main>

      <footer className={styles.footer}>
        <Link href="/">Wallet panel</Link>
        <span className={styles.footerDot}>·</span>
        <span>Nomos</span>
      </footer>
    </div>
  );
}
