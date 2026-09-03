"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CallData, cairo, num } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";
import styles from "../../../uni.module.css";
import * as constants from "@/utils/constants";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";
import SelectWallet from "../WalletHandle/SelectWallet";
import { switchConnectedWalletNetwork } from "../WalletHandle/connectWallet";
import { networkLabel } from "@/utils/networks";
import ReceiptCard from "../ReceiptCard";
import { TokenLogo } from "../../TokenIcons";
import { parseTokenAmount } from "@/utils/payments";
import { errorResult, receiptToResult, shortHex, fmtTokenAmount, type ActionResult } from "@/utils/receipt";

type Flow = "A" | "B";

// Append the payment's reference to the merchant's callback, preserving any
// query string they already set. Falls back to the bare URL if it somehow
// won't parse, rather than dropping the return link entirely.
function callbackWithReference(callbackUrl: string, reference: string | null): string {
  if (!reference) return callbackUrl;
  try {
    const url = new URL(callbackUrl);
    url.searchParams.set("reference", reference);
    return url.toString();
  } catch {
    return callbackUrl;
  }
}

type LinkData = {
  id: string;
  merchantName?: string | null;
  networkIndex: number;
  amountWei?: string;
  token: constants.TokenSymbol;
  note?: string;
  ref?: string;
  expiresAt?: number;
  revoked: boolean;
  expired: boolean;
  singleUse?: boolean;
  paid?: boolean;
  callbackUrl?: string;
  logoDataUrl?: string;
};

// Customer-facing checkout for a Payment Link. Fetches the canonical link
// record by id (GET /api/payment-links/[id]) instead of trusting raw URL
// query params - a link is inherently shareable, so anyone could edit a
// copied one before forwarding it; the amount/recipient a customer actually
// pays now always comes from the server-side record, not the URL. Settles
// into Nomos's own operating wallet — not the merchant directly — via one
// of two flows the customer picks:
//
//   Flow A ("Pay privately"): a private STRK20 transfer. Requires a
//   shielded-capable wallet (Ready, etc). Fully private end to end.
//
//   Flow B ("Pay with any wallet"): a plain public ERC-20 transfer. Works
//   with any Starknet wallet. The deposit itself is public, but which
//   merchant it's for stays private — see docs/ARCHITECTURE.md.
//
// Either way, the merchant is credited via their internal ledger balance,
// not by receiving funds directly — see docs/PRD.md for why.
export default function Checkout() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";

  const [linkData, setLinkData] = useState<LinkData | null>(null);
  const [linkError, setLinkError] = useState("");
  const [loadingLink, setLoadingLink] = useState(true);

  useEffect(() => {
    if (!id) {
      setLoadingLink(false);
      return;
    }
    setLoadingLink(true);
    fetch(`/api/payment-links/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setLinkData(d))
      .catch((e) => setLinkError(e.message ?? "Could not load this payment link."))
      .finally(() => setLoadingLink(false));
  }, [id]);

  const fixedAmount = linkData?.amountWei;
  const token: constants.TokenSymbol = linkData?.token ?? "STRK";
  const decimals = constants.tokenDecimals(token);
  const note = linkData?.note ?? null;
  const merchantName = linkData?.merchantName ?? null;
  const ref = linkData?.ref ?? null;
  const expiresAt = linkData?.expiresAt ?? null;
  const isExpired = Boolean(linkData?.expired);
  const isRevoked = Boolean(linkData?.revoked);
  // A settled invoice: payable once, and that payment already happened.
  const isAlreadyPaid = Boolean(linkData?.paid);

  const myFrontendProviderIndex = useFrontendProvider((state) => state.currentFrontendProviderIndex);
  const myWalletAccount = useStoreWallet((state) => state.myWalletAccount);
  const isConnected = useStoreWallet((state) => state.isConnected);

  const networkName = constants.Strk20Networks[myFrontendProviderIndex];
  const isStrk20Network = networkName !== undefined;
  // The link's own network is authoritative (see /api/payments, which
  // re-resolves it server-side too) - a customer's wallet connected to a
  // different network than the link would build the transaction against
  // the wrong operating wallet/token address entirely, and the server
  // would reject it after the fact. Catch that here instead.
  const linkNetworkName = linkData ? constants.Strk20Networks[linkData.networkIndex] : undefined;
  const networkMismatch = linkData !== null && myFrontendProviderIndex !== linkData.networkIndex;
  const operatingWallet = constants.operatingWalletAddress;
  const tokenAddress = constants.tokenAddressFor(token, myFrontendProviderIndex);
  const hasOperatingWallet = (() => {
    try {
      return num.toBigInt(operatingWallet) !== 0n;
    } catch {
      return false;
    }
  })();

  const [flow, setFlow] = useState<Flow>("A");
  const [customAmount, setCustomAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [paying, setPaying] = useState(false);
  // Phase, not just busy/idle: the wallet step and the on-chain wait are very
  // different waits and the button said "Confirm in your wallet" through both,
  // for up to twenty minutes.
  const [payPhase, setPayPhase] = useState<"idle" | "signing" | "confirming">("idle");
  // Set the instant a transaction is broadcast. Once this exists the payment
  // is in flight whatever happens next, so the page must never offer a clean
  // "Pay" again — a failed *receipt lookup* is not a failed payment, and
  // treating it as one is what lets someone pay the same link twice.
  const [broadcastTx, setBroadcastTx] = useState<string | null>(null);
  const [reportFailed, setReportFailed] = useState(false);
  const [switchingWallet, setSwitchingWallet] = useState(false);
  // Returned by /api/payments once the deposit is recorded; handed to the
  // merchant's callback URL so their server can verify it.
  const [paidReference, setPaidReference] = useState<string | null>(null);

  const isPaid = result?.status === "ok";

  if (loadingLink) {
    return <div className={styles.panel} />;
  }

  if (!id || linkError || !linkData) {
    return (
      <div className={styles.panel}>
        <div className={styles.warn} style={{ padding: "12px 0" }}>
          {linkError || "This payment link is missing or invalid. Ask the business for a fresh link."}
        </div>
      </div>
    );
  }

  // Hands the transaction to the server until it sticks. Verification can
  // legitimately fail for a minute or two because the transaction has not been
  // mined yet, and giving up on the first 422 is how a real payment ends up
  // unrecorded.
  async function reportPayment(txHash: string, amountWei: bigint, attempt = 0): Promise<void> {
    if (!linkData) return;
    try {
      const r = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow,
          amountWei: amountWei.toString(),
          token,
          txHash,
          networkIndex: myFrontendProviderIndex,
          linkId: linkData.id,
        }),
      });
      if (r.ok) {
        const d = await r.json().catch(() => null);
        if (d?.reference) setPaidReference(d.reference);
        setReportFailed(false);
        return;
      }
      // 409 means it is already recorded — that is success, not a retry.
      if (r.status === 409) return;
    } catch {
      // Network blip; falls through to the retry below.
    }
    if (attempt < 8) {
      setTimeout(() => void reportPayment(txHash, amountWei, attempt + 1), 5000);
    } else {
      // Out of attempts. The money moved, so say so plainly and keep the hash
      // on screen rather than pretending nothing happened.
      setReportFailed(true);
    }
  }

  async function handlePay() {
    setResult(null);
    if (!linkData) return; // unreachable past the guard above, keeps TS happy
    if (isExpired) {
      setResult(errorResult("This payment link has expired."));
      return;
    }
    if (isRevoked) {
      setResult(errorResult("This payment link has been revoked."));
      return;
    }
    if (isAlreadyPaid) {
      setResult(errorResult("This invoice has already been paid."));
      return;
    }
    const amountStr = fixedAmount ? fmtTokenAmount(BigInt(fixedAmount), decimals) : customAmount;
    const amountWei = parseTokenAmount(amountStr, decimals);
    if (amountWei === null) {
      setAmountError("Enter a positive amount, e.g. 25 or 12.5");
      return;
    }
    setAmountError("");
    if (!myWalletAccount) {
      setResult(errorResult("No wallet connected."));
      return;
    }
    if (networkMismatch) {
      setResult(errorResult(`Switch your wallet to ${linkNetworkName ?? "the right network"} to pay this link.`));
      return;
    }
    if (!hasOperatingWallet) {
      setResult(errorResult("Nomos's operating wallet isn't configured on this deployment."));
      return;
    }
    setPaying(true);
    setPayPhase("signing");
    try {
      let txH: string;
      if (flow === "A") {
        const actions: WALLET_API.STRK20_ACTION[] = [
          { type: "transfer", token: tokenAddress, amount: num.toHex(amountWei), recipient: operatingWallet },
        ];
        const r = await myWalletAccount.strk20InvokeTransaction(actions);
        txH = r.transaction_hash;
      } else {
        // Flow B: an ordinary public ERC-20 transfer — needs no STRK20
        // wallet support, works with any connected Starknet account.
        const r = await myWalletAccount.execute([
          {
            contractAddress: tokenAddress,
            entrypoint: "transfer",
            calldata: CallData.compile({ recipient: operatingWallet, amount: cairo.uint256(amountWei) }),
          },
        ]);
        txH = r.transaction_hash;
      }
      setBroadcastTx(txH);
      setPayPhase("confirming");
      setResult({
        status: "pending",
        title: "Waiting for confirmation…",
        rows: [
          { label: "Amount", value: `${fmtTokenAmount(amountWei, decimals)} ${token}` },
          { label: "Transaction", value: shortHex(txH), hash: txH },
        ],
      });

      // Report the payment the moment a hash exists, not after a receipt poll
      // succeeds. This used to sit behind `if (final.status === "ok")`, so a
      // failed *lookup* meant the payment was never reported at all — the
      // customer paid, the merchant was never credited, and the page invited
      // them to pay again. The server verifies the hash on-chain itself, which
      // is the authority here; the client's job is only to hand it over.
      void reportPayment(txH, amountWei);

      const provider = constants.myFrontendProviders[myFrontendProviderIndex];
      const txR = await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      setResult(receiptToResult(txR, txH, `${fmtTokenAmount(amountWei, decimals)} ${token}`));
    } catch (error: any) {
      setResult(errorResult(error?.message ?? error?.toString?.() ?? String(error)));
    } finally {
      setPaying(false);
      setPayPhase("idle");
    }
  }

  async function handleSwitchToLinkNetwork() {
    if (!linkData) return;
    setSwitchingWallet(true);
    try {
      await switchConnectedWalletNetwork(linkData.networkIndex);
      useFrontendProvider.getState().setCurrentFrontendProviderIndex(linkData.networkIndex);
    } catch (e: any) {
      setResult(errorResult(e?.message ?? "Could not switch wallet network."));
    } finally {
      setSwitchingWallet(false);
    }
  }

  return (
    /* Two panels: who and what on the left, how to pay on the right. This is
       what every hosted checkout converges on (Radom, Coinbase Commerce, the
       reference designs) because the two halves answer different questions
       and a payer reads them in that order. Stacks to one column on mobile,
       where the order becomes context-then-payment vertically. */
    <div className={styles.checkoutSplit}>
      <aside className={styles.checkoutBrandPanel}>
      <div className={styles.checkoutIdentity}>
        {linkData?.logoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.checkoutLogo} src={linkData.logoDataUrl} alt="" />
        ) : null}
        <div className={styles.checkoutPayee}>
          <span className={styles.checkoutPayeeLabel}>Paying</span>
          <span className={styles.checkoutPayeeName}>{merchantName ?? "this business"}</span>
          {/* Funds settle to Nomos, not to the business directly. Saying so
              is the honest counterpart to hiding the merchant's wallet: a
              payer who checks the transaction will see a Nomos address, and
              should have been told that here rather than discovering it. */}
          <span className={styles.checkoutPayeeVia}>Payments processed by Nomos</span>
        </div>
      </div>

      <div className={styles.checkoutAmountBlock}>
        {note ? <div className={styles.checkoutLineItem}>{note}</div> : null}
        <div className={styles.checkoutAmountValue}>
          {fixedAmount !== undefined ? (
            <>
              {fmtTokenAmount(BigInt(fixedAmount), decimals)}
              {/* The mark makes the token readable at a glance, the way the
                  console already shows every other amount. */}
              <span className={styles.checkoutAmountToken}>
                <TokenLogo symbol={token} size={20} />
                {token}
              </span>
            </>
          ) : (
            "Enter amount"
          )}
        </div>
      </div>

      {/* Order reference sits with the order, not with the payment controls.
          Expiry is deliberately not repeated here — the countdown states it
          in the form a payer can actually act on. */}
      {ref ? (
        <div className={styles.checkoutOrderMeta}>
          <span className={styles.summaryLabel}>Reference</span>
          <span className={styles.summaryValue}>{ref}</span>
        </div>
      ) : null}

      {/* Sits at the foot of the brand panel, the way a hosted checkout
          always attributes itself — the payer is on a Nomos page, not the
          merchant's, and should be able to see that. */}
      <div className={styles.checkoutPoweredBy}>Checkout by Nomos</div>
      </aside>

      <div className={styles.checkoutPayPanel}>
      <ExpiryCountdown expiresAt={expiresAt} paid={isPaid || isAlreadyPaid} />

      {isPaid || isExpired || isRevoked || isAlreadyPaid ? null : (
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Payment method</label>
          <div className={styles.methodGrid}>
            {/* Private is the headline option, not the constrained one. The
                cards used to read "Pay privately / Shielded wallet" against
                "Any wallet", which framed privacy as the restriction and the
                public path as the easy default — backwards for a product
                whose whole point is that the payment stays off the ledger.
                Each card now says what the payer gets, not what it requires. */}
            <button
              type="button"
              className={`${styles.methodCard} ${flow === "A" ? styles.methodCardActive : ""}`}
              onClick={() => setFlow("A")}
            >
              <span className={styles.methodCardBadge}>Recommended</span>
              <ShieldIcon />
              <span className={styles.methodCardTitle}>Private payment</span>
              <span className={styles.methodCardSub}>Nothing appears on-chain</span>
            </button>
            <button
              type="button"
              className={`${styles.methodCard} ${flow === "B" ? styles.methodCardActive : ""}`}
              onClick={() => setFlow("B")}
            >
              <WalletIcon />
              <span className={styles.methodCardTitle}>Standard payment</span>
              <span className={styles.methodCardSub}>Visible on-chain</span>
            </button>
          </div>
          <p className={styles.sectionSub} style={{ margin: "10px 0 0", fontSize: 12.5 }}>
            {flow === "A"
              ? "The amount, and that you paid at all, stay off the public chain. Needs a shielded wallet — Ready, or Braavos with Private Balances."
              : "An ordinary transfer, so the amount is public. Which business you paid still stays private."}
          </p>
          <WalletStrip flow={flow} />
        </div>
      )}

      {isPaid ? (
        <div className={styles.successCard}>
          <div className={styles.successIcon}>✓</div>
          <div className={styles.successTitle}>Payment sent</div>
          <p className={styles.successNote}>
            {flow === "A"
              ? "Shielded and settled on-chain. The business has been notified — nothing more to do here."
              : "Settled on-chain and recorded for the business — nothing more to do here."}
          </p>
          {linkData.callbackUrl ? (
            <div className={styles.nextSteps} style={{ maxWidth: 280, margin: "14px auto 0" }}>
              {/* The reference travels with the payer so the merchant's server
                  can verify it, the same shape as Paystack's callback. */}
              <a href={callbackWithReference(linkData.callbackUrl, paidReference)}>
                Return to the business →
              </a>
            </div>
          ) : null}
        </div>
      ) : isAlreadyPaid ? (
        <div className={styles.warn} style={{ padding: "0 0 12px" }}>
          This invoice has already been paid. Nothing to do here — check with the business if
          you think that&apos;s wrong.
        </div>
      ) : isRevoked ? (
        <div className={styles.warn} style={{ padding: "0 0 12px" }}>
          This payment link has been revoked. Ask the business for a fresh one.
        </div>
      ) : isExpired ? (
        <div className={styles.warn} style={{ padding: "0 0 12px" }}>
          This payment link has expired. Ask the business for a fresh one.
        </div>
      ) : fixedAmount === undefined ? (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="customAmount">
            Amount ({token})
          </label>
          <input
            id="customAmount"
            className={styles.textInput}
            placeholder="e.g. 25"
            inputMode="decimal"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
          />
          {amountError ? <div className={styles.errorText}>{amountError}</div> : null}
        </div>
      ) : null}

      {!isPaid && !isStrk20Network && isConnected ? (
        <div className={styles.warn}>
          Nomos requires Mainnet or Sepolia — switch your wallet network.
        </div>
      ) : !isPaid && networkMismatch && isConnected ? (
        <div className={styles.warn}>
          This link expects {networkLabel(linkData?.networkIndex ?? 2)} ({linkNetworkName?.toLowerCase()}).
          <button
            type="button"
            className={styles.testBannerAction}
            style={{ marginLeft: 8 }}
            disabled={switchingWallet}
            onClick={() => void handleSwitchToLinkNetwork()}
          >
            {switchingWallet ? "Switching…" : "Switch wallet network →"}
          </button>
        </div>
      ) : null}

      {isPaid || isExpired || isRevoked || isAlreadyPaid ? null : isConnected ? (
        <button
          className={styles.btnCta}
          // Disabled for good once a transaction is broadcast. Re-enabling
          // after a failed receipt lookup is what let the same link be paid
          // twice: the lookup failed, the payment had not.
          disabled={!isStrk20Network || networkMismatch || paying || broadcastTx !== null}
          onClick={handlePay}
        >
          {payPhase === "signing"
            ? "Confirm in your wallet…"
            : payPhase === "confirming" || broadcastTx !== null
              ? "Payment sent — confirming…"
              : "Pay"}
        </button>
      ) : (
        <SelectWallet variant="ctaBig" />
      )}

      {/* The payment happened but we could not get it recorded. Never silently
          swallow this: the payer's money has moved and the merchant's console
          does not know, so surface the hash they will need to quote. */}
      {reportFailed && broadcastTx ? (
        <div className={styles.warn} style={{ padding: "10px 0 0" }}>
          Your payment was sent, but we could not confirm it with the business
          automatically. Quote this transaction to them: {shortHex(broadcastTx)}
        </div>
      ) : null}

      {isPaid || isExpired || isRevoked || isAlreadyPaid ? null : <PayOnPhone />}

      {isPaid || isExpired || isRevoked || isAlreadyPaid ? null : (
        <div className={styles.trustRow}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {flow === "A" ? "Shielded through the STRK20 privacy pool" : "Which business you paid stays private"}
        </div>
      )}

      {result ? <ReceiptCard result={result} providerIndex={myFrontendProviderIndex} /> : null}
      </div>
    </div>
  );
}

// Wallets the payer actually has, not a hardcoded row of brand logos. A
// payer's real question at this point is "will this work with what I've got",
// and showing the wallets present in their browser answers it directly —
// while an empty strip is itself the honest answer that none are installed.
//
// Flow A needs shielded support, which today means Ready; Flow B works with
// anything. Filtering per flow keeps the strip from promising a wallet that
// cannot complete the selected method.
// Starknet wallets live in a phone's wallet app browser, so a payer on a
// desktop often cannot complete a payment on the machine they opened the link
// on. This hands them the page rather than asking them to retype a URL.
//
// The QR encodes this checkout's own URL — not a payment request — so a
// failed scan is a dead end, never a misdirected payment.
// A Checkout Session expires in 30 minutes by default, and a payer who does
// not know that will lose a payment part-way through. Payment Links usually
// carry no expiry at all, so this renders nothing rather than inventing
// urgency where none exists.
//
// Hidden once paid: a countdown next to a completed payment reads as though
// something is still owed.
function ExpiryCountdown({ expiresAt, paid }: { expiresAt: number | null; paid: boolean }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (expiresAt === null || paid) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [expiresAt, paid]);

  if (expiresAt === null || paid) return null;

  const left = expiresAt - now;
  if (left <= 0) {
    return <div className={`${styles.checkoutTimer} ${styles.checkoutTimerLow}`}>This payment window has closed</div>;
  }

  const mins = Math.floor(left / 60);
  const secs = left % 60;
  const hours = Math.floor(mins / 60);
  const clock =
    hours > 0
      ? `${hours}:${String(mins % 60).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${mins}:${String(secs).padStart(2, "0")}`;

  // Under two minutes is when a payer needs to feel it, not before.
  const low = left < 120;
  return (
    <div className={`${styles.checkoutTimer} ${low ? styles.checkoutTimerLow : ""}`}>
      <span className={styles.checkoutTimerLabel}>Time remaining</span>
      <span className={styles.checkoutTimerValue}>{clock}</span>
    </div>
  );
}

function PayOnPhone() {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!open || src) return;
    let cancelled = false;
    // Dynamic import: the encoder is only needed if a payer asks for it, and
    // it has no business in the main checkout bundle.
    import("qrcode")
      .then((QR) =>
        QR.toDataURL(window.location.href, { margin: 1, width: 320, errorCorrectionLevel: "M" })
      )
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, src]);

  return (
    <div className={styles.payOnPhone}>
      <button type="button" className={styles.payOnPhoneToggle} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide QR code" : "Pay from your phone"}
      </button>
      {open ? (
        <div className={styles.payOnPhoneBody}>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.payOnPhoneQr} src={src} alt="QR code linking to this checkout page" />
          ) : (
            <div className={styles.payOnPhoneQr} aria-hidden="true" />
          )}
          <p className={styles.payOnPhoneHint}>
            Scan with your phone to open this page in your wallet app.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function WalletStrip({ flow }: { flow: Flow }) {
  const [wallets, setWallets] = useState<{ name: string; icon: string }[]>([]);

  useEffect(() => {
    // Same discovery store and options as the wallet picker — eip1193Adapters:[]
    // keeps MetaMask's Snap probing (and its unlock popup) out of the page.
    let unsub: (() => void) | undefined;
    let cancelled = false;
    const toIcons = (list: readonly { name: string; icon?: unknown }[]) =>
      list.map((w) => ({ name: w.name, icon: String(w.icon ?? "") })).filter((w) => w.icon);

    import("@starknet-io/get-starknet-discovery")
      .then(({ createStore }) => {
        if (cancelled) return;
        const store = createStore({ eip1193Adapters: [] });
        setWallets(toIcons(store.getWallets()));
        unsub = store.subscribe((next) => setWallets(toIcons(next)));
      })
      .catch(() => {
        // Discovery is a nicety; the payment works without the strip.
      });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  const shown = flow === "A" ? wallets.filter((w) => /ready|argent/i.test(w.name)) : wallets;
  if (shown.length === 0) return null;

  return (
    <div className={styles.walletStrip}>
      <span className={styles.walletStripLabel}>Works with</span>
      {shown.slice(0, 4).map((w) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={w.name} className={styles.walletStripIcon} src={w.icon} alt={w.name} title={w.name} />
      ))}
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function WalletIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="2" />
      <circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" />
    </svg>
  );
}
