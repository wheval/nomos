"use client";

import Link from "next/link";
import styles from "../uni.module.css";
import Brand from "./Brand";
import SelectWallet from "./client/WalletHandle/SelectWallet";

// Shared nav across all four pages, so link availability and the brand mark
// stay consistent instead of each page hand-rolling its own copy.
//
// variant "merchant" (home, /create, /dashboard): full nav, logo links home.
// variant "customer" (/pay): logo isn't a link and merchant links are hidden
// - a customer mid-checkout shouldn't be offered a way to wander off.
export default function Nav({ variant = "merchant" }: { variant?: "merchant" | "customer" }) {
  if (variant === "customer") {
    return (
      <nav className={styles.nav}>
        <Brand />
        <SelectWallet variant="nav" />
      </nav>
    );
  }
  return (
    <nav className={styles.nav}>
      <Brand href="/" />
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Link href="/create" className={styles.navLink}>Create Payment Link</Link>
        <Link href="/dashboard" className={styles.navLink}>Dashboard</Link>
        <SelectWallet variant="nav" />
      </div>
    </nav>
  );
}
