"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import styles from "../uni.module.css";
import { BrandMark } from "./Brand";
import Switch from "./Switch";
import { useStoreWallet } from "./Wallet/walletContext";
import { useFrontendProvider } from "./client/provider/providerContext";
import { MAINNET_INDEX, SEPOLIA_INDEX, indexForChainId, networkLabel, writeStoredNetworkIndex } from "@/utils/networks";
import { forgetWallet, switchConnectedWalletNetwork } from "./client/WalletHandle/connectWallet";
import { merchantFetchInit, useMerchantAuth } from "./client/Payments/useMerchantAuth";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: OverviewIcon },
  { href: "/dashboard/transactions", label: "Transactions", icon: TransactionsIcon },
  { href: "/dashboard/payouts", label: "Payouts", icon: PayoutsIcon },
];

const PRODUCT_ITEMS = [
  { href: "/dashboard/links", label: "Payment Links", icon: LinkIcon },
  { href: "/dashboard/invoices", label: "Invoices", icon: InvoiceIcon },
];

const FOOT_ITEMS = [
  { href: "/dashboard/settings", label: "Settings", icon: SettingsIcon },
  // API keys, webhooks and the IP allowlist all live in Settings' Developers
  // group. This used to point at /integration, a public marketing page, which
  // walked the merchant straight out of the console.
  { href: "/dashboard/settings?tab=keys", label: "Developers", icon: DevelopersIcon },
];

const COLLAPSE_STORAGE_KEY = "nomos:sidebar-collapsed";

// The merchant console shell: collapsible sidebar + topbar, wrapping every
// /dashboard* page and /create.
// The Suspense boundary lives here rather than in each console page, because
// this component is what reads the query string (to tell Settings from
// Developers, which share a path) and it wraps every one of them. Putting it
// here means no page has to know.
export default function ConsoleShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ConsoleShellInner>{children}</ConsoleShellInner>
    </Suspense>
  );
}

function ConsoleShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isConnected = useStoreWallet((state) => state.isConnected);
  const address = useStoreWallet((state) => state.address);
  const walletChain = useStoreWallet((state) => state.chain);
  const myFrontendProviderIndex = useFrontendProvider((state) => state.currentFrontendProviderIndex);
  const setCurrentFrontendProviderIndex = useFrontendProvider((state) => state.setCurrentFrontendProviderIndex);
  const { secretKey, sessionReady } = useMerchantAuth();
  const isLive = myFrontendProviderIndex === MAINNET_INDEX;
  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
  const walletNetworkIndex = walletChain ? indexForChainId(walletChain) : null;
  const walletMismatch = Boolean(isConnected && walletNetworkIndex !== null && walletNetworkIndex !== myFrontendProviderIndex);

  const [collapsed, setCollapsed] = useState(false);
  const [confirmingLive, setConfirmingLive] = useState(false);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
  }, []);

  useEffect(() => {
    if (!confirmingLive) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirmingLive(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmingLive]);

  useEffect(() => {
    if (!userMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!userMenuRef.current?.contains(e.target as Node)) setUserMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setUserMenuOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (!address || !sessionReady) {
      setDisplayName(null);
      return;
    }
    fetch(`/api/merchant-profile?address=${address}&network=${myFrontendProviderIndex}`, merchantFetchInit(secretKey))
      .then((r) => (r.ok ? r.json() : { displayName: null }))
      .then((d) => setDisplayName(typeof d.displayName === "string" ? d.displayName : null))
      .catch(() => setDisplayName(null));
  }, [address, secretKey, sessionReady, myFrontendProviderIndex]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  // Switching to live moves real STRK/USDC - confirm first, same as
  // Blockradar's mainnet-switch modal. Switching back to test is always safe,
  // no confirmation needed.
  async function applyNetwork(index: number) {
    setNetworkError("");
    setSwitchingNetwork(true);
    try {
      if (isConnected) {
        await switchConnectedWalletNetwork(index);
      }
      setCurrentFrontendProviderIndex(index);
      writeStoredNetworkIndex(index);
      setConfirmingLive(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not switch the wallet network.";
      setNetworkError(message);
    } finally {
      setSwitchingNetwork(false);
    }
  }

  function renderNavLink({ href, label, icon: Icon }: { href: string; label: string; icon: () => React.ReactElement }) {
    // Two items now share /dashboard/settings and differ only by ?tab=, so
    // matching has to consider the query: compare paths first, then the tab
    // when the link names one. pathname never carries a query string.
    const [hrefPath, hrefQuery] = href.split("?");
    const wantedTab = hrefQuery ? new URLSearchParams(hrefQuery).get("tab") : null;
    const currentTab = searchParams.get("tab");
    const active =
      hrefPath === "/dashboard"
        ? pathname === "/dashboard"
        : pathname.startsWith(hrefPath) &&
          // A tabbed link matches only its own tab; an untabbed one matches
          // only when no tab is selected, so Settings and Developers never
          // light up together.
          (wantedTab ? currentTab === wantedTab : !currentTab);
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
  }

  function requestGoLive() {
    setConfirmingLive(true);
  }
  function confirmGoLive() {
    void applyNetwork(MAINNET_INDEX);
  }

  return (
    <>
    <div className={styles.consoleFrame}>
      {walletMismatch ? (
        <div className={styles.walletMismatchBanner}>
          {isLive ? "Live mode" : "Test mode"} needs {networkLabel(myFrontendProviderIndex)}, but your wallet is on{" "}
          <strong>{networkLabel(walletNetworkIndex ?? SEPOLIA_INDEX)}</strong>.{" "}
          <button
            className={styles.testBannerAction}
            disabled={switchingNetwork}
            onClick={() => void applyNetwork(myFrontendProviderIndex)}
          >
            {switchingNetwork ? "Switching…" : `Switch wallet to ${networkLabel(myFrontendProviderIndex)} →`}
          </button>
        </div>
      ) : !isLive ? (
        <div className={styles.testBanner}>
          You&apos;re in test mode on {networkLabel(myFrontendProviderIndex)}. No real funds will move.{" "}
          <button className={styles.testBannerAction} onClick={requestGoLive}>
            Switch to live mode →
          </button>
        </div>
      ) : null}
      {networkError ? <div className={styles.networkErrorBanner}>{networkError}</div> : null}
      <div className={`${styles.console} ${collapsed ? styles.collapsed : ""}`}>
      <aside className={styles.consoleSidebar}>
        <Link
          href={isConnected && address ? "/dashboard/settings" : "/"}
          className={styles.consoleSwitcher}
          title={isConnected && address ? "Business settings" : "Nomos"}
        >
          <span className={styles.consoleSwitcherIcon}>
            <BrandMark />
          </span>
          <span className={styles.consoleSwitcherText}>
            <span className={styles.consoleSwitcherName}>
              {isConnected && address ? displayName || shortAddr : "Nomos"}
            </span>
            <span className={styles.consoleSwitcherSub}>
              {isConnected && address ? (displayName ? shortAddr : "Set a business name") : "on STRK20"}
            </span>
          </span>
          <ChevronUpDownIcon />
        </Link>
        <nav className={styles.consoleNav}>{NAV_ITEMS.map(renderNavLink)}</nav>

        <div className={styles.consoleNavGroup}>Products</div>
        <nav className={`${styles.consoleNav} ${styles.consoleNavFill}`}>{PRODUCT_ITEMS.map(renderNavLink)}</nav>

        <div className={styles.consoleSidebarFoot}>
          {FOOT_ITEMS.map(renderNavLink)}
          {isConnected && address ? (
            <div className={styles.consoleUserWrap} ref={userMenuRef}>
              {userMenuOpen ? (
                <div className={styles.consoleUserMenu} role="menu">
                  <div className={styles.consoleUserMenuHead}>
                    <span className={styles.consoleUserAvatar}>{address.slice(2, 4).toUpperCase()}</span>
                    <span className={styles.consoleUserMenuIdent}>
                      <span className={styles.consoleUserMenuName}>{displayName || "Your business"}</span>
                      <span className={styles.consoleUserMenuAddr}>{shortAddr}</span>
                    </span>
                  </div>
                  <Link
                    href="/dashboard/settings"
                    className={styles.consoleUserMenuItem}
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <SettingsIcon />
                    Business settings
                    <span className={styles.consoleUserMenuChevron}>
                      <ChevronRightIcon />
                    </span>
                  </Link>
                  <button
                    className={`${styles.consoleUserMenuItem} ${styles.consoleUserMenuDanger}`}
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      forgetWallet();
                    }}
                  >
                    <DisconnectIcon />
                    Disconnect wallet
                  </button>
                </div>
              ) : null}
              <button
                className={styles.consoleUserRow}
                onClick={() => setUserMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                title="Account"
              >
                <span className={styles.consoleUserAvatar}>{address.slice(2, 4).toUpperCase()}</span>
                <span className={styles.consoleUserName}>{shortAddr}</span>
                <ChevronRightIcon />
              </button>
            </div>
          ) : null}
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

          </div>

          <div className={styles.consoleTopbarRight}>
            <span className={styles.netSwitchWrap}>
              <span className={`${styles.netSwitchLabel} ${isLive ? styles.netSwitchLabelLive : ""}`}>
                {isLive ? "Live mode" : "Test mode"}
              </span>
              <Switch
                checked={isLive}
                onChange={(next) => (next ? requestGoLive() : void applyNetwork(SEPOLIA_INDEX))}
                ariaLabel="Toggle test/live mode"
              />
            </span>
            <Link href="/dashboard/settings" className={styles.consoleIconBtn} title="Settings">
              <SettingsIcon />
            </Link>
          </div>
        </div>
        {children}
      </div>
      </div>
    </div>

      {confirmingLive ? (
        <div className={styles.modalOverlay} onClick={() => setConfirmingLive(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="live-mode-title">
            <div className={styles.modalHead}>
              <span className={styles.modalTitle} id="live-mode-title">Switch to live mode?</span>
              <button className={styles.modalClose} onClick={() => setConfirmingLive(false)} aria-label="Stay on test">
                ×
              </button>
            </div>
            <p className={styles.modalBody}>
              Live mode uses Starknet Mainnet. Payments and payouts move real STRK and USDC and
              cannot be reversed. Test mode (Sepolia) stays available whenever you switch back.
            </p>
            <div className={styles.modalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setConfirmingLive(false)}>
                Stay on test
              </button>
              <button type="button" className={styles.btnCta} disabled={switchingNetwork} onClick={confirmGoLive}>
                {switchingNetwork ? "Switching wallet…" : "Switch to live"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DisconnectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function DevelopersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronUpDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M8 9l4-4 4 4M8 15l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function InvoiceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3h9l3 3v15l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M5 4h14v16l-3-2-3 2-3-2-3 2V4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M8 9h8M8 13h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function PayoutsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 4v13M12 17l-5-5M12 17l5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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
