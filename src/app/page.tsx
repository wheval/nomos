"use client";

import styles from './uni.module.css';
import Nav from './components/Nav';
import Footer from './components/Footer';
import WalletAccountV6Tag from './components/client/WalletHandle/WalletAccountV6Tag';
import Link from 'next/link';

export default function Page() {
  return (
    <div className={styles.page}>
      <Nav variant="merchant" />

      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>
          A private payment
          <br />
          <span className={styles.heroAccent}>gateway</span>
        </h1>
        <p className={styles.heroSub}>
          Nomos shields the checkout your business already wants — Payment
          Links, invoices, and an embeddable widget, settling through the
          STRK20 pool.
        </p>
        <Link href="/create" className={styles.btnCta} style={{ display: 'inline-block', width: 'auto', marginTop: 22, textDecoration: 'none' }}>
          Create a Payment Link →
        </Link>
      </header>

      <section className={styles.toolkitBand}>
        <div className={styles.toolkitInner}>
          <div className={styles.toolkitLabel}>
            <span className={styles.brandBadge}>Wallet toolkit</span>
            <p>
              What Payment Links run on underneath — shield, send, unshield,
              echo, and read balances directly against the STRK20 pool. Not
              part of the product flow; here for anyone checking the
              integration itself.
            </p>
          </div>
          <WalletAccountV6Tag />
        </div>
      </section>

      <Footer
        extra={
          <a href="https://github.com/PhilippeR26/Starknet-WalletAccount" target="_blank" rel="noreferrer">
            Wallet toolkit source
          </a>
        }
      />
    </div>
  );
}
