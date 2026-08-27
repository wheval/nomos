"use client";

import styles from "../uni.module.css";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import WalletAccountV6Tag from "../components/client/WalletHandle/WalletAccountV6Tag";

// Live proof of the STRK20 integration Payment Links run on underneath -
// shield, send, unshield, echo, and read balances directly against the pool
// with a real connected wallet. Not a merchant-facing feature; moved off the
// landing page (where it read as clutter next to the actual product story)
// so it stays reachable for anyone verifying the integration itself.
export default function IntegrationPage() {
  return (
    <div className={styles.page}>
      <Nav variant="merchant" />

      <header className={styles.hero} style={{ margin: "46px auto 34px" }}>
        <span className={styles.brandBadge}>Wallet toolkit</span>
        <h1 className={styles.heroTitle} style={{ fontSize: "clamp(32px, 5vw, 48px)", marginTop: 16 }}>
          The STRK20 integration, live.
        </h1>
        <p className={styles.heroSub}>
          What Payment Links run on underneath — shield, send, unshield, echo,
          and read balances directly against the STRK20 pool with a real
          connected wallet. Not part of the product flow; here for anyone
          verifying the integration itself.
        </p>
      </header>

      <main>
        <WalletAccountV6Tag />
      </main>

      <Footer
        extra={
          <a href="https://github.com/PhilippeR26/Starknet-WalletAccount" target="_blank" rel="noreferrer">
            Wallet toolkit source
          </a>
        }
      />
    </div>
  );
}
