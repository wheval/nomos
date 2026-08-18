"use client";

import Link from "next/link";
import styles from "../uni.module.css";
import SelectWallet from "../components/client/WalletHandle/SelectWallet";
import CreateLink from "../components/client/Payments/CreateLink";

export default function CreatePage() {
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
