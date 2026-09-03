"use client";

import ConsoleShell from "../../components/ConsoleShell";
import CreateLink from "../../components/client/Payments/CreateLink";
import styles from "../../uni.module.css";

// Invoices are sold as their own product on the landing page and asked about
// by name in the create dialog, but the console listed them mixed in with
// reusable links. Same data, filtered on singleUse.
export default function InvoicesPage() {
  return (
    <ConsoleShell>
      <div className={styles.consolePage}>
        <CreateLink kind="invoice" />
      </div>
    </ConsoleShell>
  );
}
