"use client";

import Link from "next/link";
import styles from "../uni.module.css";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import Dashboard from "../components/client/Payments/Dashboard";

export default function DashboardPage() {
  return (
    <div className={styles.page}>
      <Nav variant="merchant" />

      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>
          Your
          <br />
          <span className={styles.heroAccent}>dashboard</span>
        </h1>
        <p className={styles.heroSub}>
          What's landed, and the key your own backend can use to check.
        </p>
      </header>

      <main>
        <Dashboard />
      </main>

      <Footer extra={<Link href="/create">Create a link</Link>} />
    </div>
  );
}
