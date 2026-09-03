"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "../../../uni.module.css";
import SelectWallet from "../WalletHandle/SelectWallet";
import { buildPaymentUrl } from "@/utils/payments";
import { fmtTokenAmount } from "@/utils/receipt";
import { tokenDecimals, type TokenSymbol } from "@/utils/constants";
import { TokenAmount } from "../../TokenIcons";
import { useMerchantAuth } from "./useMerchantAuth";
import { usePaymentLinks, expiresInLabel } from "./usePaymentLinks";
import { linkStatus, pillClass } from "./statusTone";
import { rowNavProps } from "./rowNav";
import CreateLinkModal from "./CreateLinkModal";

// The Payment Links index: what exists, and a way to make another. Creation
// moved into a dialog so the list — the thing a merchant comes here to read —
// is not pushed below a form they only need occasionally.
//
// Links are persisted server-side rather than encoded in the URL: checkout
// fetches the canonical record by id instead of trusting a copied link, and
// this list is what makes a merchant's links recoverable and auditable.
/**
 * The Payment Links index, and the Invoices index — the same list, filtered.
 *
 * The landing page sells them as separate products and the create dialog asks
 * which one you are making, but the console showed a single mixed list. A
 * merchant chasing an unpaid invoice had to read the type chip on every row.
 */
export default function CreateLink({ kind = "link" }: { kind?: "link" | "invoice" } = {}) {
  const invoices = kind === "invoice";
  const { isConnected, address, secretKey, networkIndex, sessionReady } = useMerchantAuth();
  const { links: allLinks, loadError, refresh } = usePaymentLinks(address ?? "", secretKey, networkIndex, sessionReady);
  // singleUse is what distinguishes an invoice from a reusable link, so the
  // two views are one query and a filter rather than two endpoints.
  const links = allLinks === null ? null : allLinks.filter((l) => Boolean(l.singleUse) === invoices);
  const router = useRouter();

  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isConnected) {
    return (
      <div className={styles.cPanel}>
        <div className={styles.connectPrompt}>
          <p className={styles.sectionSub}>Connect the wallet you want paid into before creating a link.</p>
          <SelectWallet variant="ctaBig" />
        </div>
      </div>
    );
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const createdUrl = justCreated ? buildPaymentUrl(origin, justCreated) : "";

  return (
    <>
      <div className={styles.cPanel}>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.pageHeadTitle}>{invoices ? "Invoices" : "Payment Links"}</h1>
            <p className={styles.pageHeadSub}>
              {invoices
                ? "Billed to one person and payable once. Anyone who opens it later is told it is settled."
                : "One link, any number of payments. The amount and the payer stay shielded in the STRK20 pool."}
            </p>
          </div>
          <div className={styles.pageHeadActions}>
            <button type="button" className={styles.settingsBtn} onClick={() => setCreating(true)}>
              <PlusIcon />
              {invoices ? "Create invoice" : "Create payment link"}
            </button>
          </div>
        </div>

        <div className={styles.pageBody}>
          {justCreated ? (
            <div className={styles.receipt} style={{ marginBottom: 18 }}>
              <div className={styles.receiptHead}>
                <span className={styles.receiptIcon} style={{ background: "var(--green)" }}>✓</span>
                Link created — share this with your customer
              </div>
              <div className={styles.copyField} style={{ marginTop: 12 }}>
                <a className={styles.copyFieldValue} href={createdUrl} target="_blank" rel="noreferrer">
                  {createdUrl}
                </a>
                <button
                  type="button"
                  className={styles.iconBtn}
                  title="Copy link"
                  onClick={() => {
                    navigator.clipboard.writeText(createdUrl).then(
                      () => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      },
                      () => {},
                    );
                  }}
                >
                  {copied ? "✓" : "Copy"}
                </button>
              </div>
              <div className={styles.nextSteps} style={{ marginTop: 12 }}>
                <Link href={`/dashboard/links/${justCreated}`}>Open its page →</Link>
                <a href={createdUrl} target="_blank" rel="noreferrer">Preview as customer ↗</a>
              </div>
            </div>
          ) : null}

          {loadError ? (
            <div className={styles.errorText}>{loadError}</div>
          ) : links === null ? (
            <div className={styles.emptyBox}><p>Loading…</p></div>
          ) : links.length === 0 ? (
            <div className={styles.emptyBox}>
              <p>
                {invoices
                  ? "No invoices yet. Create one to bill someone directly."
                  : "No payment links yet. Create one to start taking payments."}
              </p>
              <button
                type="button"
                className={styles.settingsBtn}
                style={{ marginTop: 16 }}
                onClick={() => setCreating(true)}
              >
                <PlusIcon />
                {invoices ? "Create invoice" : "Create payment link"}
              </button>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Expires</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {links.map((l) => {
                    const url = buildPaymentUrl(origin, l.id);
                    const status = linkStatus(l);
                    return (
                      <tr key={l.id} {...rowNavProps(router, `/dashboard/links/${l.id}`)}>
                        <td>
                          <Link href={`/dashboard/links/${l.id}`} className={styles.rowTitleLink}>
                            {l.note ?? l.ref}
                          </Link>
                        </td>
                        <td>
                          <span className={styles.cellChip}>{l.singleUse ? "Invoice" : "Reusable"}</span>
                        </td>
                        <td className={styles.cellStrong}>
                          {l.amountWei !== undefined ? (
                            <TokenAmount
                              amount={fmtTokenAmount(BigInt(l.amountWei), tokenDecimals(l.token as TokenSymbol))}
                              symbol={l.token}
                            />
                          ) : (
                            "Customer enters"
                          )}
                        </td>
                        <td>
                          <span className={pillClass(status.tone)}>{status.label}</span>
                        </td>
                        <td className={styles.cellMuted}>{expiresInLabel(l) ?? "—"}</td>
                        <td className={styles.cellMuted}>{new Date(l.createdAt * 1000).toLocaleDateString()}</td>
                        <td>
                          <div className={styles.txActions}>
                            <a className={styles.txLink} href={url} target="_blank" rel="noreferrer" title="Open link">
                              View ↗
                            </a>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard.writeText(url).catch(() => {})}
                              title="Copy link"
                            >
                              Copy
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <CreateLinkModal
        initialKind={invoices ? "invoice" : undefined}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setJustCreated(id);
          refresh();
        }}
        merchantAddress={address}
        secretKey={secretKey}
        networkIndex={networkIndex}
      />
    </>
  );
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
