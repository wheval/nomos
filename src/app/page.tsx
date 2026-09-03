"use client";

import styles from './uni.module.css';
import Nav from './components/Nav';
import Footer from './components/Footer';
import { ApiDemo, WebhookDemo, NoFeeCalculator, WalletsGrid, Faq } from './components/LandingSections';
import Link from 'next/link';

export default function Page() {
  return (
    <div className={styles.page}>
      <Nav variant="merchant" />

      <header className={styles.hero}>
        <div>
          <span className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            Built for the STRK20 Private Sprint
          </span>
          <h1 className={styles.heroTitle}>
            A private payment
            <br />
            <span className={styles.heroAccent}>gateway</span>
          </h1>
          <p className={styles.heroSub}>
            Already accept stablecoins? Add privacy without changing your
            stack — Payment Links, hosted Checkout, or a direct API
            integration, all settling through the STRK20 privacy pool so the
            amount, your balance and your identity never touch the public
            chain. Live on Starknet mainnet.
          </p>
          <div className={styles.heroCtaRow}>
            <Link href="/create" className={styles.btnCta} style={{ display: 'inline-block', width: 'auto', margin: 0, textDecoration: 'none' }}>
              Create a Payment Link →
            </Link>
            <Link href="/dashboard" className={`${styles.btn} ${styles.btnGhost}`} style={{ textDecoration: 'none' }}>
              View live dashboard
            </Link>
          </div>
          <p className={styles.heroTrust}>No card, no signup — connect a wallet and go.</p>
        </div>
      </header>

      {/* Grouped by who the reader is, the way every comparable gateway
          organises its own product menu. The previous list mixed products
          (link, invoice) with delivery mechanisms (widget, API) in one row of
          four, which left a merchant and a developer both scanning past
          things that were not for them. */}
      <section style={{ margin: '64px 0' }}>
        <div className={styles.sectionEyebrow}>Products</div>
        <h2 className={styles.sectionHeading}>However you want to get paid</h2>

        <div className={styles.productGroupLabel}>For merchants</div>
        <div className={styles.howItWorks}>
          <div className={styles.howStep}>
            <div className={styles.howStepNum}><LinkIcon /></div>
            <h3>Payment Links</h3>
            <p>Generate a link with a fixed or open amount. Share it anywhere — the customer pays without ever touching your dashboard.</p>
          </div>
          <div className={styles.howStep}>
            <div className={styles.howStepNum}><InvoiceIcon /></div>
            <h3>Invoices</h3>
            <p>Add a note and an expiry, payable once. It reads like a real invoice, backed by a private settlement instead of a public one.</p>
          </div>
          <div className={styles.howStep}>
            <div className={styles.howStepNum}><WidgetIcon /></div>
            <h3>Embedded widget</h3>
            <p>Drop one script tag on your own site. A &quot;Pay with Nomos&quot; button opens checkout in place — no redirect, no rebuild.</p>
          </div>
        </div>

        <div className={styles.productGroupLabel}>For developers</div>
        <div className={styles.howItWorks}>
          <div className={styles.howStep}>
            <div className={styles.howStepNum}><ApiIcon /></div>
            <h3>Payments API</h3>
            <p>Create sessions, verify a payment by reference, read balances and trigger payouts straight from your own backend — no UI required.</p>
          </div>
          <div className={styles.howStep}>
            <div className={styles.howStepNum}><CheckoutIcon /></div>
            <h3>Hosted Checkout</h3>
            <p>Create a session per order from your backend, redirect the customer to a hosted page, and get them back on your site once it&apos;s paid.</p>
          </div>
          <div className={styles.howStep}>
            <div className={styles.howStepNum}><WebhookIcon /></div>
            <h3>Webhooks</h3>
            <p>Get a signed callback the moment a payment settles, so you can ship the order without polling for it.</p>
          </div>
        </div>
      </section>

      <section style={{ margin: '64px 0' }}>
        <div className={styles.sectionEyebrow}>Why Nomos</div>
        <h2 className={styles.sectionHeading}>Whatever wallet your customer has</h2>
        <p className={styles.sectionSubCentered}>
          Not every customer has a shielded wallet yet. Nomos accepts both —
          and settles both into the same private balance.
        </p>
        <div className={styles.flowGrid}>
          <div className={styles.flowCard}>
            <div className={styles.flowCardIcon}><ShieldIcon /></div>
            <h3>Customer has a shielded wallet</h3>
            <p>Their payment is a private STRK20 transfer, direct into the pool. Sender, receiver, and amount are shielded end to end — nothing extra to do.</p>
          </div>
          <div className={styles.flowJoin}>
            <span className={styles.flowJoinLine} />
            <span className={styles.flowJoinLabel}>one private balance</span>
            <span className={styles.flowJoinLine} />
          </div>
          <div className={styles.flowCard}>
            <div className={styles.flowCardIcon}><WalletIcon /></div>
            <h3>Customer has an ordinary wallet</h3>
            <p>They send a normal transfer — no privacy wallet required. Nomos shields it into your balance on your behalf, so your identity still never touches the public chain.</p>
          </div>
        </div>
      </section>

      <ApiDemo />
      <WebhookDemo />
      <WalletsGrid />
      <NoFeeCalculator />
      <Faq />

      <section className={styles.closingCta} style={{ margin: '64px auto 0' }}>
        <h2 className={styles.sectionHeading} style={{ marginBottom: 12 }}>Ready to accept private payments?</h2>
        <p>Generate your first Payment Link in under a minute, or skip the UI and wire up the API directly.</p>
        <Link href="/create" className={styles.btnCta} style={{ display: 'inline-block', width: 'auto', margin: 0, textDecoration: 'none' }}>
          Create a Payment Link →
        </Link>
      </section>

      <Footer
        extra={
          <Link href="/integration">Wallet toolkit</Link>
        }
      />
    </div>
  );
}

function LinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M9 15L15 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M10.5 6.5L11.6 5.4a3.5 3.5 0 0 1 5 5L15.5 11.5M13.5 17.5L12.4 18.6a3.5 3.5 0 0 1-5-5L8.5 12.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function InvoiceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M6 3h9l3 3v15H6V3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 10h6M9 14h6M9 18h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function WidgetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ApiIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="7" cy="7.5" r="1" fill="currentColor" />
      <circle cx="7" cy="16.5" r="1" fill="currentColor" />
    </svg>
  );
}
function CheckoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="2" />
      <path d="M7 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function WebhookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4a4 4 0 0 0-3.5 5.9L6 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18 12a4 4 0 0 0-6.9-2.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 19h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="6" cy="17" r="2.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="18" cy="15" r="2.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function WalletIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="2" />
      <circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" />
    </svg>
  );
}
