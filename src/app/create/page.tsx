"use client";

import styles from "../uni.module.css";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import CreateLink from "../components/client/Payments/CreateLink";

export default function CreatePage() {
  return (
    <div className={styles.page}>
      <Nav variant="merchant" />

      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>
          Get paid,
          <br />
          <span className={styles.heroAccent}>privately</span>
        </h1>
        <p className={styles.heroSub}>
          Generate a Payment Link. Whoever pays it, the amount and their
          identity stay shielded in the STRK20 pool.
        </p>
      </header>

      <main>
        <CreateLink />
      </main>

      <Footer />
    </div>
  );
}
