"use client";

import styles from "../uni.module.css";

// Reusable toggle switch — the Test/Live, Active-style control from the
// design reference. A styled button (not a checkbox input) so it can sit
// inline with a text label either side of it.
export default function Switch({
  checked,
  onChange,
  label,
  activeLabel,
  danger,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  activeLabel?: string;
  danger?: boolean;
  ariaLabel?: string;
}) {
  return (
    <span className={styles.switchWrap}>
      {label ? <span className={`${styles.switchLabel} ${!checked ? styles.switchLabelOn : ""}`}>{label}</span> : null}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        className={`${styles.switch} ${checked ? styles.switchOn : ""} ${danger ? styles.switchDanger : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.switchThumb} />
      </button>
      {activeLabel ? <span className={`${styles.switchLabel} ${checked ? styles.switchLabelOn : ""}`}>{activeLabel}</span> : null}
    </span>
  );
}
