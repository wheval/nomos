import styles from "../uni.module.css";

// Nomos's own wordmark - replaces the bare STRK20 protocol logo that used to
// stand in for the product's identity in every page's nav. Keeps STRK20 as
// a small attribution badge rather than the primary mark.
export default function Brand() {
  return (
    <div className={styles.brand}>
      <svg className={styles.brandMark} viewBox="0 0 64 64" width="26" height="26" aria-hidden="true">
        <rect width="64" height="64" rx="15" fill="#e56b43" />
        <g stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" fill="none">
          <path d="M14 22 V15.5 A1.5 1.5 0 0 1 15.5 14 H22" />
          <path d="M42 14 H48.5 A1.5 1.5 0 0 1 50 15.5 V22" />
          <path d="M50 42 V48.5 A1.5 1.5 0 0 1 48.5 50 H42" />
          <path d="M22 50 H15.5 A1.5 1.5 0 0 1 14 48.5 V42" />
        </g>
        <g fill="#ffffff">
          <rect x="21" y="19" width="6.4" height="26" rx="0.6" />
          <rect x="36.6" y="19" width="6.4" height="26" rx="0.6" />
          <polygon points="27.4,19 33.8,19 36.6,45 30.2,45" />
        </g>
      </svg>
      Nomos
      <span className={styles.brandBadge}>on STRK20</span>
    </div>
  );
}
