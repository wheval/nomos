"use client";

import { useEffect, useState } from "react";
import styles from "../uni.module.css";

type ThemeChoice = "light" | "dark" | "system";
const STORAGE_KEY = "nomos:theme";

// Light / Dark / System, applied as a data-theme attribute on the nearest
// .console ancestor (the console root — see uni.module.css). "system"
// means no attribute at all, so the prefers-color-scheme media query in
// CSS takes over; explicit light/dark override it either direction.
export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  function apply(next: ThemeChoice) {
    const root = document.querySelector(`.${styles.console}`);
    if (!root) return;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
  }

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      setChoice(stored);
      apply(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(next: ThemeChoice) {
    setChoice(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    apply(next);
  }

  return (
    <div className={styles.themeToggle}>
      <button
        type="button"
        className={`${styles.themeToggleBtn} ${choice === "light" ? styles.themeToggleActive : ""}`}
        onClick={() => pick("light")}
        title="Light"
        aria-label="Light theme"
      >
        <SunIcon />
      </button>
      <button
        type="button"
        className={`${styles.themeToggleBtn} ${choice === "dark" ? styles.themeToggleActive : ""}`}
        onClick={() => pick("dark")}
        title="Dark"
        aria-label="Dark theme"
      >
        <MoonIcon />
      </button>
      <button
        type="button"
        className={`${styles.themeToggleBtn} ${choice === "system" ? styles.themeToggleActive : ""}`}
        onClick={() => pick("system")}
        title="System"
        aria-label="System theme"
      >
        <SystemIcon />
      </button>
    </div>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
function SystemIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
