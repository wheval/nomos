"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CallData, cairo, num, validateAndParseAddress } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";
import styles from "../../../uni.module.css";
import * as constants from "@/utils/constants";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";
import SelectWallet from "../WalletHandle/SelectWallet";
import ReceiptCard from "../ReceiptCard";
import { parseTokenAmount } from "@/utils/payments";
import { errorResult, receiptToResult, shortHex, fmtTokenAmount, type ActionResult } from "@/utils/receipt";

type Flow = "A" | "B";

// Customer-facing checkout for a Payment Link. Reads {to, amount, note}
// from the URL and settles into Nomos's own operating wallet — not the
// merchant directly — via one of two flows the customer picks:
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
  const to = params.get("to") ?? "";
  const fixedAmount = params.get("amount");
  const tokenParam = params.get("token");
  const token: constants.TokenSymbol = constants.isTokenSymbol(tokenParam) ? tokenParam : "STRK";
  const decimals = constants.tokenDecimals(token);
  const note = params.get("note");
  const ref = params.get("ref");
  const expParam = params.get("exp");
  const expiresAt = expParam ? Number(expParam) : null;
  const isExpired = expiresAt !== null && Number.isFinite(expiresAt) && Date.now() / 1000 > expiresAt;

  const myFrontendProviderIndex = useFrontendProvider((state) => state.currentFrontendProviderIndex);
  const myWalletAccount = useStoreWallet((state) => state.myWalletAccount);
  const isConnected = useStoreWallet((state) => state.isConnected);

  const networkName = constants.Strk20Networks[myFrontendProviderIndex];
  const isStrk20Network = networkName !== undefined;
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

  let toValid = "";
  try {
    toValid = to ? validateAndParseAddress(to) : "";
  } catch {
    toValid = "";
  }
  const shortTo = toValid ? `${toValid.slice(0, 6)}…${toValid.slice(-4)}` : "";
  const isPaid = result?.status === "ok";

  if (!toValid) {
    return (
      <div className={styles.panel}>
        <div className={styles.warn} style={{ padding: "12px 0" }}>
          This payment link is missing or has an invalid recipient. Ask the
          business for a fresh link.
        </div>
      </div>
    );
  }

  async function handlePay() {
    setResult(null);
    if (isExpired) {
      setResult(errorResult("This payment link has expired."));
      return;
    }
    const amountStr = fixedAmount ?? customAmount;
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
    if (!hasOperatingWallet) {
      setResult(errorResult("Nomos's operating wallet isn't configured on this deployment."));
      return;
    }
    setPaying(true);
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
      setResult({
        status: "pending",
        title: "Waiting for confirmation…",
        rows: [
          { label: "Amount", value: `${fmtTokenAmount(amountWei, decimals)} ${token}` },
          { label: "Transaction", value: shortHex(txH), hash: txH },
        ],
      });
      const provider = constants.myFrontendProviders[myFrontendProviderIndex];
      const txR = await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      const final = receiptToResult(txR, txH, `${fmtTokenAmount(amountWei, decimals)} ${token}`);
      setResult(final);
      if (final.status === "ok") {
        // Best-effort order bookkeeping for the merchant dashboard - never
        // blocks or fails the payment itself, which already confirmed on-chain.
        // Server re-verifies this on-chain before crediting anything - see
        // src/utils/verifyTx.ts.
        fetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flow,
            merchantAddress: toValid,
            amountWei: amountWei.toString(),
            token,
            txHash: txH,
            networkIndex: myFrontendProviderIndex,
            note: note ?? undefined,
            ref: ref ?? undefined,
          }),
        }).catch(() => {});
      }
    } catch (error: any) {
      setResult(errorResult(error?.message ?? error?.toString?.() ?? String(error)));
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.checkoutAmountBlock}>
        <div className={styles.checkoutAmountLabel}>You&apos;re paying</div>
        <div className={styles.checkoutAmountValue}>
          {fixedAmount ? (
            <>
              {fixedAmount}
              <span>{token}</span>
            </>
          ) : (
            "Enter amount"
          )}
        </div>
        <div className={styles.checkoutMeta}>
          to <b>{shortTo}</b>
          {note ? ` · ${note}` : ""}
        </div>
      </div>

      {isPaid || isExpired ? null : (
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Payment method</label>
          <div className={styles.methodGrid}>
            <button
              type="button"
              className={`${styles.methodCard} ${flow === "A" ? styles.methodCardActive : ""}`}
              onClick={() => setFlow("A")}
            >
              <ShieldIcon />
              <span className={styles.methodCardTitle}>Pay privately</span>
              <span className={styles.methodCardSub}>Shielded wallet</span>
            </button>
            <button
              type="button"
              className={`${styles.methodCard} ${flow === "B" ? styles.methodCardActive : ""}`}
              onClick={() => setFlow("B")}
            >
              <WalletIcon />
              <span className={styles.methodCardTitle}>Any wallet</span>
              <span className={styles.methodCardSub}>Public transfer</span>
            </button>
          </div>
          <p className={styles.sectionSub} style={{ margin: "10px 0 0", fontSize: 12.5 }}>
            {flow === "A"
              ? "Needs a shielded wallet (Ready, or Argent/Braavos with Private Balances)."
              : "Works with any Starknet wallet — which business you paid still stays private."}
          </p>
        </div>
      )}

      {ref || expiresAt !== null ? (
        <div className={styles.summaryCard}>
          {ref ? (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Reference</span>
              <span className={styles.summaryValue}>{ref}</span>
            </div>
          ) : null}
          {expiresAt !== null ? (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Expires</span>
              <span className={styles.summaryValue} style={isExpired ? { color: "var(--danger)" } : undefined}>
                {isExpired ? "Expired" : new Date(expiresAt * 1000).toLocaleString()}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {isPaid ? (
        <div className={styles.successCard}>
          <div className={styles.successIcon}>✓</div>
          <div className={styles.successTitle}>Payment sent</div>
          <p className={styles.successNote}>
            {flow === "A"
              ? "Shielded and settled on-chain. The business has been notified — nothing more to do here."
              : "Settled on-chain and recorded for the business — nothing more to do here."}
          </p>
        </div>
      ) : isExpired ? (
        <div className={styles.warn} style={{ padding: "0 0 12px" }}>
          This payment link has expired. Ask the business for a fresh one.
        </div>
      ) : !fixedAmount ? (
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
          Nomos requires Mainnet or Sepolia - switch your wallet network.
        </div>
      ) : null}

      {isPaid || isExpired ? null : isConnected ? (
        <button className={styles.btnCta} disabled={!isStrk20Network || paying} onClick={handlePay}>
          {paying ? "Confirm in your wallet…" : "Pay"}
        </button>
      ) : (
        <SelectWallet variant="ctaBig" />
      )}

      {isPaid || isExpired ? null : (
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
