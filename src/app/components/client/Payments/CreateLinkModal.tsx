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
  // Decided by the page that opened this, not asked again inside it.
  kind,
}: {
  kind: Kind;
  open: boolean;
  onClose: () => void;
  // The created link, plus what the caller needs to offer a send action.
  onCreated: (id: string, details: { customerEmail?: string; summary: string }) => void;
  merchantAddress: string;
  secretKey: string | null;
  networkIndex: number;
}) {
  // Which kind this is comes from the page that opened it — Payment Links or
  // Invoices — so the dialog no longer asks. The chooser step it used to show
  // was answered before the merchant ever clicked.
  const [token, setToken] = useState<TokenSymbol>("STRK");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [fixedAmount, setFixedAmount] = useState(true);
  const [expirySeconds, setExpirySeconds] = useState<number | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [advanced, setAdvanced] = useState(false);
  // A reusable link that closes after its first payment — a limited offer, a
  // one-off bill to no one in particular. Distinct from an invoice, which is
  // addressed to a named person and emailed to them.
  const [oncePerLink, setOncePerLink] = useState(false);
  // Who the invoice is for. Invoices are billed to someone; a link is not.
  const [customerEmail, setCustomerEmail] = useState("");
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
    setName("");
    setAmount("");
    setFixedAmount(true);
    setOncePerLink(false);
    setCustomerEmail("");
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
          singleUse: kind === "invoice" || oncePerLink,
          customerEmail: kind === "invoice" && customerEmail.trim() ? customerEmail.trim() : undefined,
          callbackUrl: callbackUrl.trim() || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      onCreated(d.id, {
        customerEmail: d.customerEmail,
        summary: [name.trim(), fixedAmount && amount.trim() ? `${amount.trim()} ${token}` : null]
          .filter(Boolean)
          .join(" — "),
      });
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
            {kind === "invoice" ? "Create an invoice" : "Create a reusable link"}
          </span>
          <button className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {(

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

              {kind === "invoice" ? (
                <div className={styles.settingsField}>
                  <label className={styles.settingsLabel} htmlFor="invoiceEmail">
                    Customer email
                  </label>
                  <input
                    id="invoiceEmail"
                    type="email"
                    className={styles.settingsInput}
                    placeholder="name@company.com"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                  />
                  <p className={styles.settingsHint}>
                    Who the invoice is for. You get a prepared email to send once it&apos;s created.
                  </p>
                </div>
              ) : (
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={oncePerLink}
                    onChange={(e) => setOncePerLink(e.target.checked)}
                  />
                  <span>
                    <span className={styles.checkRowLabel}>Accept only one payment</span>
                    <span className={styles.checkRowHint}>
                      The link closes after the first payment and tells anyone who opens it later.
                    </span>
                  </span>
                </label>
              )}

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
                onClick={onClose}
              >
                Cancel
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

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
