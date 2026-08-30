"use client";

import ConsoleShell from "../components/ConsoleShell";
import CreateLink from "../components/client/Payments/CreateLink";
import styles from "../uni.module.css";

export default function CreatePage() {
  return (
    <ConsoleShell>
      {/* The panel carries its own heading and Create action, like the other
          list pages — no separate page header above it. */}
      <div className={styles.consolePage}>
        <CreateLink />
      </div>
    </ConsoleShell>
  );
}
