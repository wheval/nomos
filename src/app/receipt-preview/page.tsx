"use client";

import PaymentReceipt from "../components/client/Payments/PaymentReceipt";
import styles from "../uni.module.css";

// Static preview of the payment receipt, so its layout and print output can be
// checked without making a real payment. Not linked from anywhere.
export default function ReceiptPreview() {
  return (
    <div className={styles.page}>
      <main style={{ paddingTop: 40 }}>
        <div className={styles.panel}>
          <PaymentReceipt
            merchantName="Ancore"
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
