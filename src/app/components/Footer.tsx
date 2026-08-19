import Link from "next/link";
import styles from "../uni.module.css";

// Shared footer. Each page can pass one extra link relevant to where it is
// in the flow (e.g. /create points at the wallet toolkit, /dashboard points
// back at /create) - "extra" always renders before the standard STRK20 credit.
export default function Footer({ extra }: { extra?: React.ReactNode }) {
  return (
    <footer className={styles.footer}>
      {extra}
      {extra ? <span className={styles.footerDot}>·</span> : null}
      <span>Nomos</span>
      <span className={styles.footerDot}>·</span>
      <a href="https://strk20.starknet.io" target="_blank" rel="noreferrer">
        Powered by STRK20
      </a>
    </footer>
  );
}

export function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href}>{children}</Link>;
}
