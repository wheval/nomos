"use client";

import { useEffect, useState } from "react";
import PaymentReceipt from "../components/client/Payments/PaymentReceipt";
import styles from "../uni.module.css";

// Renders the receipt against a real payment link, so what shows here is what
// a payer actually gets — merchant name and logo included. Pass ?id=<linkId>
// to preview a different merchant. Not linked from anywhere.
const DEFAULT_LINK = "5ff440f9-83fb-4154-ae58-48de7c2910c7";

export default function ReceiptPreview() {
  const [link, setLink] = useState<{ merchantName?: string | null; logoDataUrl?: string } | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id") ?? DEFAULT_LINK;
    fetch(`/api/payment-links/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setLink)
      .catch(() => {});
  }, []);

  return (
    <div className={styles.page}>
      <main style={{ paddingTop: 40 }}>
        <div className={styles.panel}>
          <PaymentReceipt
            merchantName={link?.merchantName ?? null}
            logoDataUrl={link?.logoDataUrl}
            amount="1.500002"
            token="USDC"
            reference="nx_faa16bbc7a1a4ead81e2"
            txHash="0x04691e2b437d2770081676eeb16a664dfcd0052a4f9ca88fec192a7f16d76380"
            flow="A"
            networkIndex={2}
            paidAt={Math.floor(Date.now() / 1000)}
          />
        </div>
      </main>
    </div>
  );
}
