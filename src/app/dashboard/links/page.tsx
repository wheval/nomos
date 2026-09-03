"use client";

import ConsoleShell from "../../components/ConsoleShell";
import CreateLink from "../../components/client/Payments/CreateLink";
import styles from "../../uni.module.css";

// The Payment Links list. It used to live only at /create, which meant
// /dashboard/links 404'd even though /dashboard/links/[id] served every link's
// detail page — so the obvious URL, and the natural way back from a detail
// page, both dead-ended. This is the canonical list now; /create redirects
// here so older shared URLs keep working.
export default function LinksPage() {
  return (
    <ConsoleShell>
      <div className={styles.consolePage}>
        <CreateLink />
      </div>
    </ConsoleShell>
  );
}
