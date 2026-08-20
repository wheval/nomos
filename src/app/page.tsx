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

      <section style={{ margin: '84px 0 76px' }}>
        <div className={styles.sectionEyebrow}>How it works</div>
        <h2 className={styles.sectionHeading}>Three ways to get paid</h2>
        <div className={styles.howItWorks}>
          <div className={styles.howStep}>
            <div className={styles.howStepNum}>01</div>
            <h3>Payment Link</h3>
            <p>Generate a link with a fixed or open amount. Share it anywhere — the customer pays without ever touching your dashboard.</p>
          </div>
          <div className={styles.howStep}>
            <div className={styles.howStepNum}>02</div>
            <h3>Invoice</h3>
            <p>Add a note and an expiry. It reads like a real invoice, backed by a private settlement instead of a public one.</p>
          </div>
          <div className={styles.howStep}>
            <div className={styles.howStepNum}>03</div>
            <h3>Embedded widget</h3>
            <p>Drop one script tag on your own site. A "Pay with Nomos" button opens checkout in place — no redirect, no rebuild.</p>
          </div>
        </div>
      </section>

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
