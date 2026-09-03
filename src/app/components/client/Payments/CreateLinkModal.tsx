"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../../../uni.module.css";
import { parseTokenAmount, EXPIRY_CHOICES } from "@/utils/payments";
import { TokenSymbols, tokenDecimals, type TokenSymbol } from "@/utils/constants";
import { TokenAmount } from "../../TokenIcons";

type Kind = "page" | "invoice";

// Creating a link in two steps: pick what kind of thing you're making, then
// fill it in. Splitting them keeps the reusable page and the one-off invoice
// from sharing one form full of fields that only apply to half of it — and
// makes the choice explicit rather than a checkbox someone skims past.
export default function CreateLinkModal({
  open,
  onClose,
  onCreated,
  merchantAddress,
  secretKey,
  networkIndex,
  // Opening from Invoices skips the "what kind?" step — the merchant already
  // answered it by being on that page.
  initialKind,
}: {
  initialKind?: Kind;
  open: boolean;
  onClose: () => void;
  onCreated: (url: string) => void;
  merchantAddress: string;
  secretKey: string | null;
  networkIndex: number;
}) {
  const [kind, setKind] = useState<Kind | null>(initialKind ?? null);

  // Reset on each open. Without this the dialog reopens on whatever was picked
  // last time, so a merchant who backed out of an invoice gets the invoice form
  // again next time they meant to make a link.
  useEffect(() => {
    if (open) setKind(initialKind ?? null);
  }, [open, initialKind]);
  const [token, setToken] = useState<TokenSymbol>("STRK");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [fixedAmount, setFixedAmount] = useState(true);
  const [expirySeconds, setExpirySeconds] = useState<number | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset on close so reopening never inherits a half-filled previous attempt.
  useEffect(() => {
    if (open) return;
    setKind(null);
    setName("");
    setAmount("");
    setFixedAmount(true);
    setExpirySeconds(null);
    setCallbackUrl("");
    setAdvanced(false);
    setError("");
  }, [open]);

  if (!open) return null;

  async function handleCreate() {
    setError("");
    if (fixedAmount && !amount.trim()) {
      setError("Enter the amount to charge, or let the customer choose one.");
      return;
    }
    if (fixedAmount && parseTokenAmount(amount, tokenDecimals(token)) === null) {
      setError("Amount must be a positive number, e.g. 25 or 12.5");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          merchantAddress,
          ...(secretKey ? { secretKey } : {}),
          networkIndex,
          token,
          amount: fixedAmount ? amount.trim() : undefined,
          note: name.trim() || undefined,
          expiresIn: expirySeconds ?? undefined,
          singleUse: kind === "invoice",
          callbackUrl: callbackUrl.trim() || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      onCreated(d.id);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not create the link.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={`${styles.modal} ${styles.modalWide}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-link-title"
      >
        <div className={styles.modalHead}>
          <span className={styles.modalTitle} id="create-link-title">
            {kind === null
              ? "Create a payment link"
              : kind === "invoice"
                ? "Create an invoice"
                : "Create a reusable link"}
          </span>
          <button className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {kind === null ? (
          <>
            <p className={styles.modalSub}>
              Choose the kind of payment you want to collect.
            </p>
            <div className={styles.typeChoice}>
              <span className={styles.typeChoiceIcon}>
                <PageIcon />
              </span>
              <span className={styles.typeChoiceText}>
                <span className={styles.typeChoiceTitle}>Reusable link</span>
                <span className={styles.typeChoiceDesc}>
                  Share one link and take any number of payments, from any number of people.
                </span>
              </span>
              <button
                type="button"
                className={`${styles.settingsBtn} ${styles.settingsBtnGhost}`}
                onClick={() => setKind("page")}
              >
                Choose
              </button>
            </div>
            <div className={styles.typeChoice}>
              <span className={styles.typeChoiceIcon}>
                <InvoiceIcon />
              </span>
              <span className={styles.typeChoiceText}>
                <span className={styles.typeChoiceTitle}>Invoice</span>
                <span className={styles.typeChoiceDesc}>
                  Bill one person once. It closes after the first payment and tells anyone
                  who opens it later that it&apos;s already paid.
                </span>
              </span>
              <button
                type="button"
                className={`${styles.settingsBtn} ${styles.settingsBtnGhost}`}
                onClick={() => setKind("invoice")}
              >
                Choose
              </button>
            </div>
            {/* Recurring is absent on purpose: charging on a schedule means
                pulling funds against a standing mandate, and a shielded
                balance can't be debited without its holder signing. */}
          </>
        ) : (
          <>
            <div className={styles.modalScroll} ref={scrollRef}>
              <div className={styles.settingsField}>
                <label className={styles.settingsLabel} htmlFor="linkName">
                  {kind === "invoice" ? "What is this for?" : "What are you collecting for?"}
                </label>
                <input
                  id="linkName"
                  className={styles.settingsInput}
                  placeholder={kind === "invoice" ? "e.g. Invoice 1041" : "e.g. Donations"}
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
                <p className={styles.settingsHint}>Shown to the customer at checkout.</p>
              </div>

              <div className={styles.settingsField}>
                <label className={styles.settingsLabel}>Token</label>
                <div className={styles.chipRow}>
                  {TokenSymbols.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`${styles.chip} ${token === t ? styles.chipActive : ""}`}
                      onClick={() => setToken(t)}
                    >
                      <TokenAmount symbol={t} />
                    </button>
                  ))}
                </div>
              </div>

              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={fixedAmount}
                  onChange={(e) => setFixedAmount(e.target.checked)}
                />
                <span>
                  <span className={styles.checkRowLabel}>Charge a fixed amount</span>
                  <span className={styles.checkRowHint}>
                    Uncheck to let the customer enter what they pay.
                  </span>
                </span>
              </label>

              {fixedAmount ? (
                <div className={styles.settingsField}>
                  <label className={styles.settingsLabel} htmlFor="linkAmount">
                    Amount ({token})
                  </label>
                  <input
                    id="linkAmount"
                    className={styles.settingsInput}
                    placeholder="25"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              ) : null}

              <div className={styles.settingsField}>
                <label className={styles.settingsLabel}>Expires</label>
                <div className={styles.chipRow}>
                  {EXPIRY_CHOICES.map((choice) => (
                    <button
                      key={choice.label}
                      type="button"
                      className={`${styles.chip} ${expirySeconds === choice.seconds ? styles.chipActive : ""}`}
                      onClick={() => setExpirySeconds(choice.seconds)}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              </div>

              {advanced ? (
                <>
                  <div className={styles.modalDivider} />
                  <div className={styles.settingsField}>
                    <label className={styles.settingsLabel} htmlFor="callbackUrl">
                      Redirect after payment
                    </label>
                    <input
                      id="callbackUrl"
                      className={styles.settingsInput}
                      placeholder="https://your-site.example.com/thanks"
                      value={callbackUrl}
                      onChange={(e) => setCallbackUrl(e.target.value)}
                    />
                    <p className={styles.settingsHint}>
                      Where the customer goes once they&apos;ve paid. Nomos adds{" "}
                      <code>?reference=</code> so your server can verify the payment.
                    </p>
                  </div>
                </>
              ) : null}

            </div>

            {/* Outside the scrolling body: a control the reader has to scroll
                to find may as well not exist. */}
            <button
              type="button"
              className={`${styles.advToggle} ${advanced ? styles.advOpen : ""}`}
              onClick={() => {
                const next = !advanced;
                setAdvanced(next);
                // Reveal what just appeared rather than leaving it below the fold.
                if (next) {
                  requestAnimationFrame(() => {
                    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
                  });
                }
              }}
              aria-expanded={advanced}
            >
              {advanced ? "Hide advanced options" : "Show advanced options"}
              <ChevronIcon />
            </button>

            {/* Outside the scroller for the same reason as the toggle above:
                the body caps at 380px and this form runs longer, so an error
                rendered inside it lands below the fold and the submit looks
                like it did nothing at all. */}
            {error ? <div className={`${styles.errorText} ${styles.modalError}`}>{error}</div> : null}

            <div className={styles.modalFoot}>
              <button
                type="button"
                className={`${styles.settingsBtn} ${styles.settingsBtnGhost}`}
                onClick={() => setKind(null)}
              >
                Back
              </button>
              <button
                type="button"
                className={styles.settingsBtn}
                disabled={submitting}
                onClick={() => void handleCreate()}
              >
                {submitting ? "Creating…" : kind === "invoice" ? "Create invoice" : "Create link"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 14h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function InvoiceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
