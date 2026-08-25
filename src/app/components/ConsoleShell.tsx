"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "../uni.module.css";
import { BrandMark } from "./Brand";
import ThemeToggle from "./ThemeToggle";
import Switch from "./Switch";
import { useStoreWallet } from "./Wallet/walletContext";
import { useFrontendProvider } from "./client/provider/providerContext";
import * as constants from "@/utils/constants";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: OverviewIcon },
  { href: "/create", label: "Payment Links", icon: LinkIcon },
  { href: "/dashboard/transactions", label: "Transactions", icon: TransactionsIcon },
  { href: "/dashboard/payouts", label: "Payouts", icon: PayoutsIcon },
  { href: "/dashboard/settings", label: "Settings", icon: SettingsIcon },
];

// The only two real, connectable STRK20 networks (constants.Strk20Networks).
// 0 = Mainnet ("live"), 2 = Sepolia ("test") — a plain boolean toggle, same
// as the Test/Live switch in the design reference, not a multi-option menu.
const MAINNET_INDEX = 0;
const SEPOLIA_INDEX = 2;

const COLLAPSE_STORAGE_KEY = "nomos:sidebar-collapsed";

// The merchant console shell: collapsible sidebar + topbar, wrapping every
// /dashboard* page and /create. This is the actual product surface — a
// business's day-to-day tool, not a marketing page — so it gets its own
// theme (light/dark/system, see uni.module.css's .console block) instead
// of the public site's fixed light/hero treatment.
export default function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isConnected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);
  const setConnected = useStoreWallet((state) => state.setConnected);
  const myFrontendProviderIndex = useFrontendProvider((state) => state.currentFrontendProviderIndex);
  const setCurrentFrontendProviderIndex = useFrontendProvider((state) => state.setCurrentFrontendProviderIndex);
  const networkName = constants.Strk20Networks[myFrontendProviderIndex] ?? "Unsupported";
  const isLive = myFrontendProviderIndex === MAINNET_INDEX;
  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <>
      {!isLive ? (
        <div className={styles.testBanner}>
          You&apos;re currently on <strong>test mode</strong> ({networkName.toLowerCase()}). Payments here don&apos;t move real funds.{" "}
          <button className={styles.testBannerAction} onClick={() => setCurrentFrontendProviderIndex(MAINNET_INDEX)}>
            Switch to live mode →
          </button>
        </div>
      ) : null}
      <div className={`${styles.console} ${collapsed ? styles.collapsed : ""}`}>
      <aside className={styles.consoleSidebar}>
        <Link href="/" className={styles.consoleBrand} style={{ textDecoration: "none" }}>
          <BrandMark />
          <span>Nomos</span>
          <span className={styles.brandBadge}>on STRK20</span>
        </Link>
        <nav className={styles.consoleNav}>
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`${styles.consoleNavLink} ${active ? styles.consoleNavActive : ""}`}
                title={collapsed ? label : undefined}
              >
                <Icon />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className={styles.consoleSidebarFoot}>
          <a href="https://strk20.starknet.io" target="_blank" rel="noreferrer">
            Powered by STRK20
          </a>
        </div>
      </aside>

      <div className={styles.consoleMain}>
        <div className={styles.consoleTopbar}>
          <div className={styles.consoleTopbarLeft}>
            <button
              className={styles.consoleCollapseBtn}
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <CollapseIcon />
            </button>

            <span className={styles.netSwitchWrap}>
              <span className={`${styles.netSwitchLabel} ${!isLive ? styles.netSwitchLabelLive : ""}`} style={!isLive ? { color: "#d97706" } : undefined}>
                Test
              </span>
              <Switch
                checked={isLive}
                onChange={(next) => setCurrentFrontendProviderIndex(next ? MAINNET_INDEX : SEPOLIA_INDEX)}
                ariaLabel="Toggle test/live mode"
              />
              <span className={`${styles.netSwitchLabel} ${isLive ? styles.netSwitchLabelLive : ""}`}>Live</span>
            </span>
          </div>

          <div className={styles.consoleTopbarRight}>
            <ThemeToggle />
            {isConnected && address ? (
              <button className={styles.consoleAddrPill} onClick={() => setConnected(false)} title="Disconnect">
                <span className={styles.netDot} style={{ background: "var(--green)" }} />
                {shortAddr}
              </button>
            ) : null}
          </div>
        </div>
        {children}
      </div>
      </div>
    </>
  );
}

function CollapseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 4v16" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function OverviewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M9 15L15 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M10.5 6.5L11.6 5.4a3.5 3.5 0 0 1 5 5L15.5 11.5M13.5 17.5L12.4 18.6a3.5 3.5 0 0 1-5-5L8.5 12.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function TransactionsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M5 4h14v16l-3-2-3 2-3-2-3 2V4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M8 9h8M8 13h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function PayoutsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 4v13M12 17l-5-5M12 17l5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
