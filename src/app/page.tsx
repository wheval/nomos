"use client";

import styles from './uni.module.css';
import Nav from './components/Nav';
import Footer from './components/Footer';
import { ApiDemo, WebhookDemo, NoFeeCalculator, WalletsGrid, Faq } from './components/LandingSections';
import Link from 'next/link';

// Landing page laid out on the CoinDash template's rhythm: a centred hero
// over a band of live facts, then problem, product, proof, price, steps.
// The reference's palette and typeface are deliberately not copied — the
// warm accent and DM Sans run through the console, the receipt and the
// favicon, and a landing page in someone else's violet would introduce the
// product as a different one from the product it links into.
//
// The stat band carries facts rather than the reference's customer logos.
// Nomos has no customers to name yet, and inventing logos is the one kind of
// borrowing that would actually be dishonest.

export default function Page() {
  return (
    <div className={`${styles.page} ${styles.landing}`}>
      <Nav variant="merchant" />

      <div className={styles.landShell}>
        <header className={styles.landHero}>
          <span className={styles.landEyebrow}>
            <span className={styles.landEyebrowDot} />
            Live on Starknet mainnet
          </span>
          <h1 className={styles.landHeroTitle}>
            Take payments nobody<br />else can <em>read</em>
          </h1>
          <p className={styles.landHeroSub}>
            A payment gateway that settles through the STRK20 privacy pool, so
            the amount, your balance and your identity never touch the public
            chain. Payment Links, hosted Checkout, or a direct API — whichever
            fits the stack you already have.
          </p>
          <div className={styles.landCtaRow}>
            <Link href="/create" className={`${styles.landBtn} ${styles.landBtnPrimary}`}>
              Create a Payment Link
            </Link>
            <Link href="/docs" className={`${styles.landBtn} ${styles.landBtnGhost}`}>
              Read the docs
            </Link>
          </div>
          <p className={styles.landTrust}>No card, no signup — connect a wallet and go.</p>

          <div className={styles.landStatBand}>
            <div className={styles.landStat}>
              <div className={styles.landStatValue}>0.01</div>
              <div className={styles.landStatLabel}>USDC per private payment</div>
            </div>
            <div className={styles.landStat}>
              <div className={styles.landStatValue}>0%</div>
              <div className={styles.landStatLabel}>of the amount, ever</div>
            </div>
            <div className={styles.landStat}>
              <div className={styles.landStatValue}>2</div>
              <div className={styles.landStatLabel}>checkout flows, one balance</div>
            </div>
            <div className={styles.landStat}>
              <div className={styles.landStatValue}>STRK20</div>
              <div className={styles.landStatLabel}>privacy pool, on mainnet</div>
            </div>
          </div>
        </header>

        {/* Problem, stated before the product — the reference opens this way
            and it is right for Nomos too: nobody searches for a privacy
            gateway, they arrive annoyed about something else. */}
        <section className={styles.landSection}>
          <div className={styles.landHeadCentered}>
            <span className={styles.landEyebrow}>The problem</span>
            <h2 className={styles.landH2}>Getting paid on-chain publishes your business</h2>
            <p className={styles.landLede}>
              Every stablecoin payment you accept today is a public record of
              what you charged, who paid it, and what you are worth.
            </p>
          </div>
          <div className={styles.landGrid3}>
            <div className={styles.landCard}>
              <div className={styles.landCardIcon}><EyeIcon /></div>
              <h3>Your revenue is public</h3>
              <p>
                Anyone with your address can read every payment you have ever
                taken and total it up — competitors, customers, and whoever is
                deciding what to quote you.
              </p>
            </div>
            <div className={styles.landCard}>
              <div className={styles.landCardIcon}><PercentIcon /></div>
              <h3>Processors bill a percentage</h3>
              <p>
                Card rails take a share of every sale because their costs scale
                with it. Settling on Starknet costs the same whether the payment
                is ten dollars or a hundred thousand.
              </p>
            </div>
            <div className={styles.landCard}>
              <div className={styles.landCardIcon}><WrenchIcon /></div>
              <h3>Rolling it yourself is the real cost</h3>
              <p>
                The privacy pool is a public protocol. Checkout, links,
                verification, payouts, webhooks and reconciliation on top of it
                are the months you would rather not spend.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.landSection}>
          <div className={styles.landHeadCentered}>
            <span className={styles.landEyebrow}>Products</span>
            <h2 className={styles.landH2}>However you want to get paid</h2>
            <p className={styles.landLede}>
              Same private settlement underneath, whichever surface you reach for.
            </p>
          </div>

          <div className={styles.productGroupLabel}>For merchants</div>
          <div className={styles.landGrid3} style={{ marginTop: 16 }}>
            <div className={styles.landCard}>
              <div className={styles.landCardIcon}><LinkIcon /></div>
              <h3>Payment Links</h3>
              <p>Generate a link with a fixed or open amount. Share it anywhere — the customer pays without ever touching your dashboard.</p>
            </div>
            <div className={styles.landCard}>
              <div className={styles.landCardIcon}><InvoiceIcon /></div>
              <h3>Invoices</h3>
              <p>Add a note, an email and an expiry, payable once. It reads like a real invoice, backed by a private settlement instead of a public one.</p>
            </div>
            <div className={styles.landCard}>
              <div className={styles.landCardIcon}><WidgetIcon /></div>
              <h3>Embedded widget</h3>
              <p>Drop one script tag on your own site. A &quot;Pay with Nomos&quot; button opens checkout in place — no redirect, no rebuild.</p>
            </div>
          </div>

          <div className={styles.productGroupLabel}>For developers</div>
          <div className={styles.landGrid3} style={{ marginTop: 16 }}>
            <div className={styles.landCard}>
              <div className={styles.landCardIcon}><ApiIcon /></div>
              <h3>Payments API</h3>
              <p>Create sessions, verify a payment by reference, read balances and trigger payouts straight from your own backend — no UI required.</p>
            </div>
            <div className={styles.landCard}>
              <div className={styles.landCardIcon}><CheckoutIcon /></div>
              <h3>Hosted Checkout</h3>
              <p>Create a session per order from your backend, redirect the customer to a hosted page, and get them back on your site once it&apos;s paid.</p>
            </div>
            <div className={styles.landCard}>
              <div className={styles.landCardIcon}><WebhookIcon /></div>
              <h3>Webhooks</h3>
              <p>Get a signed callback the moment a payment settles, so you can ship the order without polling for it.</p>
            </div>
          </div>
        </section>

        <section className={styles.landSection}>
          <div className={styles.landHeadCentered}>
            <span className={styles.landEyebrow}>Whatever wallet they have</span>
            <h2 className={styles.landH2}>Your customer does not need a privacy wallet</h2>
            <p className={styles.landLede}>
              Nomos accepts both kinds of payment and settles them into the same
              private balance.
            </p>
          </div>
          <div className={styles.landGrid2}>
            <div className={styles.landCard}>
              <div className={styles.landCardIcon}><ShieldIcon /></div>
              <h3>They have a shielded wallet</h3>
              <p>Their payment is a private STRK20 transfer, straight into the pool. Sender, receiver and amount are shielded end to end — nothing extra to do.</p>
            </div>
            <div className={styles.landCard}>
              <div className={styles.landCardIcon}><WalletIcon /></div>
              <h3>They have an ordinary wallet</h3>
              <p>They send a normal transfer. Nomos shields it into your balance on your behalf, so your identity still never touches the public chain.</p>
            </div>
          </div>
        </section>

        {/* The pricing argument is the strongest thing Nomos has to say, so it
            gets a table rather than a sentence. Figures are the ones in
            /docs/pricing, not rounded for effect. */}
        <section className={styles.landSection}>
          <div className={styles.landHeadCentered}>
            <span className={styles.landEyebrow}>The cost</span>
            <h2 className={styles.landH2}>A flat fee, never a percentage</h2>
            <p className={styles.landLede}>
              A ten dollar payment and a hundred thousand dollar payment cost the
              same to accept, because they cost us the same to settle.
            </p>
          </div>
          <div className={styles.landCompareWrap}>
            <table className={styles.landCompare}>
              <thead>
                <tr>
                  <th>Payment</th>
                  <th className={styles.landCompareHeadUs}>Nomos</th>
                  <th>Card processor, 2.9% + 30c</th>
                  <th>Railgun, shielding only</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>10</td><td className={styles.landCompareUs}>0.01</td><td>0.59</td><td>0.03</td></tr>
                <tr><td>100</td><td className={styles.landCompareUs}>0.01</td><td>3.20</td><td>0.25</td></tr>
                <tr><td>1,000</td><td className={styles.landCompareUs}>0.01</td><td>29.30</td><td>2.50</td></tr>
                <tr><td>100,000</td><td className={styles.landCompareUs}>0.01</td><td>2,900</td><td>250</td></tr>
              </tbody>
            </table>
          </div>

          <div className={styles.landPriceGrid}>
            <div className={`${styles.landPrice} ${styles.landPriceFeatured}`}>
              <div className={styles.landPriceName}>Private payment</div>
              <div className={styles.landPriceValue}>0.01 USDC</div>
              <div className={styles.landPriceAlt}>or 0.4 STRK</div>
              <p className={styles.landPriceNote}>
                The payer sends from a shielded balance and covers the pool fee
                themselves. The more private option is also the cheaper one.
              </p>
            </div>
            <div className={styles.landPrice}>
              <div className={styles.landPriceName}>Public payment</div>
              <div className={styles.landPriceValue}>0.02 USDC</div>
              <div className={styles.landPriceAlt}>or 0.8 STRK</div>
              <p className={styles.landPriceNote}>
                Lands unshielded, so Nomos shields it for you. That is a second
                pool operation at our expense, which is why it costs double.
              </p>
            </div>
            <div className={styles.landPrice}>
              <div className={styles.landPriceName}>Payout</div>
              <div className={styles.landPriceValue}>0.05 USDC</div>
              <div className={styles.landPriceAlt}>or 2 STRK</div>
              <p className={styles.landPriceNote}>
                Charged per withdrawal, not per payment. Ten payments settled in
                one payout cost the same as one.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.landSection}>
          <div className={styles.landHeadCentered}>
            <span className={styles.landEyebrow}>Getting started</span>
            <h2 className={styles.landH2}>Three steps, no account to create</h2>
          </div>
          <div className={styles.landSteps}>
            <div className={styles.landStep}>
              <div className={styles.landStepNum}>1</div>
              <h3>Connect a wallet</h3>
              <p>Your wallet is the login. You sign a statement to prove it is yours — no email, no password, no onboarding form.</p>
            </div>
            <div className={styles.landStep}>
              <div className={styles.landStepNum}>2</div>
              <h3>Make a link</h3>
              <p>Pick a token and an amount, or leave it open. Send the link, embed the button, or create sessions from your backend.</p>
            </div>
            <div className={styles.landStep}>
              <div className={styles.landStepNum}>3</div>
              <h3>Withdraw when you like</h3>
              <p>Payments accumulate as a private balance. Withdraw publicly to any address, or privately to a shielded one.</p>
            </div>
          </div>
        </section>
      </div>

      <ApiDemo />
      <WebhookDemo />
      <WalletsGrid />
      <NoFeeCalculator />
      <Faq />

      <div className={styles.landShell}>
        <section className={styles.landClosing}>
          <h2 className={styles.landH2} style={{ marginTop: 0 }}>Ready to accept private payments?</h2>
          <p className={styles.landLede} style={{ marginInline: 'auto' }}>
            Generate your first Payment Link in under a minute, or skip the UI
            and wire up the API directly.
          </p>
          <div className={styles.landCtaRow}>
            <Link href="/create" className={`${styles.landBtn} ${styles.landBtnPrimary}`}>
              Create a Payment Link
            </Link>
            <Link href="/docs/quickstart" className={`${styles.landBtn} ${styles.landBtnGhost}`}>
              Quickstart
            </Link>
          </div>
        </section>
      </div>

      <Footer extra={<Link href="/integration">Wallet toolkit</Link>} />
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function PercentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="8" cy="8" r="2.6" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="2.6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function WrenchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M15.5 3.5a5 5 0 0 0-6.1 6.4L3.6 15.7a2 2 0 0 0 2.8 2.8l5.8-5.8a5 5 0 0 0 6.4-6.1l-3 3-2.4-.6-.6-2.4 3-3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
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
