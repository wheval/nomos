import Link from "next/link";
import styles from "./uni.module.css";
import Nav from "./components/Nav";
import Footer from "./components/Footer";

// Next's default 404 is an unstyled black page with no way back — off-brand
// for anything a customer mistypes, and the first thing a judge sees if they
// guess a URL.
export default function NotFound() {
  return (
    <div className={styles.page}>
      <Nav />
      <main style={{ paddingTop: 72 }}>
        <div className={styles.panel} style={{ textAlign: "center" }}>
          <div className={styles.notFoundCode}>404</div>
          <h1 className={styles.notFoundTitle}>This page doesn&apos;t exist</h1>
          <p className={styles.notFoundBody}>
            If you followed a payment link, ask the business for a fresh one —
            links can expire or be revoked.
          </p>
          <div className={styles.notFoundActions}>
            <Link href="/" className={styles.btnCta} style={{ display: "inline-block", width: "auto", margin: 0, textDecoration: "none" }}>
              Go home
            </Link>
            <Link href="/docs" className={`${styles.btn} ${styles.btnGhost}`} style={{ textDecoration: "none" }}>
              Read the docs
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
