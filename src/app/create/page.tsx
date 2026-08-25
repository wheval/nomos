"use client";

import ConsoleShell from "../components/ConsoleShell";
import CreateLink from "../components/client/Payments/CreateLink";
import styles from "../uni.module.css";

export default function CreatePage() {
  return (
    <ConsoleShell>
      <div className={styles.consolePage}>
        <div className={styles.consoleHead}>
          <h1 className={styles.consoleTitle}>Payment Links</h1>
          <p className={styles.consoleSub}>Generate a link. Whoever pays it, the amount and their identity stay shielded in the STRK20 pool.</p>
        </div>
        <CreateLink />
      </div>
    </ConsoleShell>
  );
}
