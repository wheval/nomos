"use client";

import { useState } from "react";
import styles from "../uni.module.css";

// Ferro-structured product-demo sections for the landing page. Every value
// shown here is real - actual API routes, actual webhook payload shape
// (src/utils/webhook.ts), actual supported wallets/tokens. Nothing here is a
// placeholder or a stand-in for data Nomos doesn't have yet.

export function ApiDemo() {
  const [endpoint, setEndpoint] = useState<"record" | "balance" | "payout">("record");

  const requests: Record<typeof endpoint, { curl: string; node: string; response: string }> = {
    record: {
      curl: `curl -X POST https://nomos-henna.vercel.app/api/payments \\
  -H "Content-Type: application/json" \\
  -d '{
    "flow": "A",
    "merchantAddress": "0x06b4...e1f2",
    "amountWei": "25000000",
    "token": "USDC",
    "txHash": "0x0a1b...",
    "networkIndex": 2
  }'`,
      node: `await fetch('https://nomos-henna.vercel.app/api/payments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    flow: 'A',
    merchantAddress: '0x06b4...e1f2',
    amountWei: '25000000',
    token: 'USDC',
    txHash: '0x0a1b...',
    networkIndex: 2,
  }),
});`,
      response: `{
  "ok": true,
  "status": "verified"
}`,
    },
    balance: {
      curl: `curl https://nomos-henna.vercel.app/api/payments?to=0x06b4...e1f2 \\
  -H "Authorization: Bearer sk_live_..."`,
      node: `await fetch('https://nomos-henna.vercel.app/api/payments?to=0x06b4...e1f2', {
  headers: { Authorization: 'Bearer sk_live_...' },
});`,
      response: `{
  "deposits": [ { "id": "...", "amountWei": "25000000", "token": "USDC", "status": "verified" } ],
  "balances": { "STRK": "412500000000000000000", "USDC": "25000000" }
}`,
    },
    payout: {
      curl: `curl -X POST https://nomos-henna.vercel.app/api/payouts \\
  -H "Content-Type: application/json" \\
  -d '{
    "merchantAddress": "0x06b4...e1f2",
    "secretKey": "sk_live_...",
    "destination": "0x0dead...",
    "amountWei": "10000000",
    "token": "USDC",
    "mode": "withdraw"
  }'`,
      node: `await fetch('https://nomos-henna.vercel.app/api/payouts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    merchantAddress: '0x06b4...e1f2',
    secretKey: 'sk_live_...',
    destination: '0x0dead...',
    amountWei: '10000000',
    token: 'USDC',
    mode: 'withdraw',
  }),
});`,
      response: `{
  "ok": true,
  "payoutId": "...",
  "status": "confirmed",
  "txHash": "0x0c3d..."
}`,
    },
  };

  const current = requests[endpoint];

  return (
    <section className={styles.demoSection}>
      <div className={styles.demoHead}>
        <h2 className={styles.demoHeading}>
          Make <span>API calls</span> against your ledger.
        </h2>
        <p className={styles.demoSub}>
          Every route your dashboard uses is public - record a payment, check a
          balance, or trigger a payout straight from your own backend.
        </p>
      </div>
      <div className={styles.demoPanel}>
        <div className={styles.demoTabs}>
          <button
            type="button"
            className={`${styles.demoTab} ${endpoint === "record" ? styles.demoTabActive : ""}`}
            onClick={() => setEndpoint("record")}
          >
            POST /api/payments
          </button>
          <button
            type="button"
            className={`${styles.demoTab} ${endpoint === "balance" ? styles.demoTabActive : ""}`}
            onClick={() => setEndpoint("balance")}
          >
            GET /api/payments
          </button>
          <button
            type="button"
            className={`${styles.demoTab} ${endpoint === "payout" ? styles.demoTabActive : ""}`}
            onClick={() => setEndpoint("payout")}
          >
            POST /api/payouts
          </button>
        </div>
        <div className={styles.demoCodeGrid}>
          <div className={styles.demoCodeCol}>
            <div className={styles.demoCodeLabel}>cURL</div>
            <pre className={styles.demoCode}>{current.curl}</pre>
          </div>
          <div className={styles.demoCodeCol}>
            <div className={styles.demoCodeLabel}>Response</div>
            <pre className={styles.demoCode}>{current.response}</pre>
          </div>
        </div>
      </div>
    </section>
  );
}

export function WebhookDemo() {
  const [flow, setFlow] = useState<"a" | "b">("a");

  const payloads: Record<typeof flow, string> = {
    a: `POST <your webhook URL>
X-Nomos-Event: payment.received
X-Nomos-Signature: sha256=<hmac>

{
  "event": "payment.received",
  "id": "0x0a1b...",
  "data": {
    "id": "dep_...",
    "merchantAddress": "0x06b4...e1f2",
    "flow": "A",
    "txHash": "0x0a1b...",
    "amountWei": "25000000",
    "token": "USDC",
    "status": "verified",
    "recordedAt": 1772000000
  }
}`,
    b: `POST <your webhook URL>
X-Nomos-Event: payment.received
X-Nomos-Signature: sha256=<hmac>

{
  "event": "payment.received",
  "id": "0x0a1b...",
  "data": {
    "id": "dep_...",
    "merchantAddress": "0x06b4...e1f2",
    "flow": "B",
    "txHash": "0x0a1b...",
    "shieldTxHash": "0x0c3d...",
    "amountWei": "25000000",
    "token": "USDC",
    "status": "shielded",
    "recordedAt": 1772000000
  }
}`,
  };

  return (
    <section className={styles.demoSection}>
      <div className={styles.demoHead}>
        <h2 className={styles.demoHeading}>
          Get a <span>webhook</span> the moment you&apos;re paid.
        </h2>
        <p className={styles.demoSub}>
          One event, <code>payment.received</code>, HMAC-signed with your
          secret key so you can verify it&apos;s really from Nomos.
        </p>
      </div>
      <div className={styles.demoPanel}>
        <div className={styles.demoTabs}>
          <button
            type="button"
            className={`${styles.demoTab} ${flow === "a" ? styles.demoTabActive : ""}`}
            onClick={() => setFlow("a")}
          >
            Flow A · fires instantly
          </button>
          <button
            type="button"
            className={`${styles.demoTab} ${flow === "b" ? styles.demoTabActive : ""}`}
            onClick={() => setFlow("b")}
          >
            Flow B · after shielding
          </button>
        </div>
        <div className={styles.webhookIntro}>
          {flow === "a"
            ? "Customer paid from a shielded wallet - already private, credited and delivered right away."
            : "Customer paid from an ordinary wallet - delivered once the deposit has been shielded into your balance."}
        </div>
        <div className={styles.webhookCode}>
          <pre className={styles.demoCode}>{payloads[flow]}</pre>
        </div>
      </div>
    </section>
  );
}

export function NoFeeCalculator() {
  const PRESETS = [10, 20, 50, 100, 250, 500, 1000];
  const [amount, setAmount] = useState(100);

  return (
    <section className={styles.demoSection}>
      <div className={styles.demoHead}>
        <h2 className={styles.demoHeading}>
          <span>Zero fees</span>, however much you&apos;re settling.
        </h2>
        <p className={styles.demoSub}>
          No processing cut, no monthly minimums, no tiers. What your
          customer sends is what lands in your balance.
        </p>
      </div>
      <div className={styles.demoPanel}>
        <div className={styles.calcGrid}>
          <div className={styles.calcCol}>
            <div className={styles.calcStat}>0%</div>
            <div className={styles.calcStatLabel}>Nomos processing fee</div>
            <div className={styles.calcPresets}>
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`${styles.calcPreset} ${amount === p ? styles.calcPresetActive : ""}`}
                  onClick={() => setAmount(p)}
                >
                  ${p}
                </button>
              ))}
            </div>
            <div className={styles.calcSliderRow}>
              <span>Payment amount</span>
              <b>${amount.toFixed(2)}</b>
            </div>
            <input
              type="range"
              min={10}
              max={1000}
              step={1}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className={styles.calcSlider}
            />
            <div className={styles.calcSliderMinMax}>
              <span>$10</span>
              <span>$1,000</span>
            </div>
          </div>
          <div className={styles.calcCol}>
            <div className={styles.calcBreakdownRow}>
              <span>Customer pays</span>
              <b>${amount.toFixed(2)}</b>
            </div>
            <div className={styles.calcBreakdownRow}>
              <span>Nomos processing fee</span>
              <b>$0.00</b>
            </div>
            <div className={`${styles.calcBreakdownRow} ${styles.highlight}`}>
              <span>Lands in your balance</span>
              <b>${amount.toFixed(2)}</b>
            </div>
            <p className={styles.calcFinePrint}>
              Only cost is the network&apos;s own gas, paid by whoever
              signs the transaction - Nomos never takes a cut.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function WalletMarkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="2" />
      <circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function WalletsGrid() {
  const WALLETS = ["Ready", "Argent X", "Braavos"];
  return (
    <section className={styles.demoSection}>
      <div className={styles.demoHead} style={{ justifyContent: "center", textAlign: "center" }}>
        <h2 className={styles.demoHeading} style={{ maxWidth: "none", margin: "0 auto" }}>
          Works with the <span>wallet</span> your customer already has.
        </h2>
      </div>
      <div className={styles.walletsGrid}>
        {WALLETS.map((w) => (
          <div key={w} className={styles.walletTile}>
            <WalletMarkIcon />
            {w}
          </div>
        ))}
      </div>
    </section>
  );
}

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "What is Nomos?",
    a: "A private payment gateway for Starknet. Customers pay via Payment Link, invoice, or embedded widget, and it all settles through the STRK20 privacy pool - your balance and identity never touch the public chain.",
  },
  {
    q: "Do I need to sign up?",
    a: "No account or signup to receive payments - connect the wallet you want paid into and generate a Payment Link. An API key is only needed if you want programmatic access to your deposit history, payouts, or webhooks.",
  },
  {
    q: "What if my customer doesn't have a privacy wallet?",
    a: "They pay with an ordinary wallet - Argent, Braavos, anything - via a normal public transfer. Nomos shields it into your balance on your behalf, so which business they paid still never touches the public chain.",
  },
  {
    q: "Where does my money sit before I withdraw it?",
    a: "Nomos's own operating wallet holds the aggregate shielded balance; your dashboard tracks your ledger claim on it. A payout settles it into your own address, publicly or privately - your choice.",
  },
  {
    q: "Which tokens can I accept?",
    a: "STRK and USDC today, picked per Payment Link. STRK20 is a privacy protocol, not a single-token system, so more can be added as the pool onboards them.",
  },
  {
    q: "What does it cost?",
    a: "Nothing. Nomos doesn't charge a processing fee - the only cost is the network's own gas, paid by whoever signs the transaction.",
  },
];

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  return (
    <section className={styles.demoSection}>
      <div className={styles.demoHead}>
        <h2 className={styles.demoHeading}>
          Questions you&apos;d <span>ask</span>, already answered.
        </h2>
        <p className={styles.demoSub}>
          Plainly, no jargon - the things you&apos;d want to know before
          connecting a wallet.
        </p>
      </div>
      <div className={styles.faqList}>
        {FAQ_ITEMS.map((item, i) => {
          const open = openIndex === i;
          return (
            <div key={item.q} className={styles.faqItem}>
              <button
                type="button"
                className={styles.faqQuestion}
                onClick={() => setOpenIndex(open ? null : i)}
                aria-expanded={open}
              >
                {item.q}
                <span className={styles.faqToggle}>{open ? "−" : "+"}</span>
              </button>
              {open ? <p className={styles.faqAnswer}>{item.a}</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
