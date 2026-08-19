import styles from "../uni.module.css";

// Nomos's own wordmark - replaces the bare STRK20 protocol logo that used to
// stand in for the product's identity in every page's nav. Keeps STRK20 as
// a small attribution badge rather than the primary mark.
export default function Brand() {
  return (
    <div className={styles.brand}>
      <span className={styles.brandMark}>N</span>
      Nomos
      <span className={styles.brandBadge}>on STRK20</span>
    </div>
  );
}
