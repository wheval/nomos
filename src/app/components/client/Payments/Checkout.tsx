"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { num, validateAndParseAddress } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";
import styles from "../../../uni.module.css";
import * as constants from "@/utils/constants";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";
import SelectWallet from "../WalletHandle/SelectWallet";
import ReceiptCard from "../ReceiptCard";
import { parseStrkAmount } from "@/utils/payments";
import { errorResult, receiptToResult, shortHex, fmtStrk, type ActionResult } from "@/utils/receipt";

const TOKEN = constants.addrSTRK;

// Customer-facing checkout for a Payment Link. Reads {to, amount, note} from
// the URL and submits a single private transfer via the connected wallet -
// same STRK20 action the wallet panel's "Send" tab uses, aimed at whoever
// generated the link instead of back at the sender.
export default function Checkout() {
  const params = useSearchParams();
  const to = params.get("to") ?? "";
  const fixedAmount = params.get("amount");
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
    const amountWei = parseStrkAmount(amountStr);
    if (amountWei === null) {
      setAmountError("Enter a positive amount, e.g. 25 or 12.5");
      return;
    }
    setAmountError("");
    if (!myWalletAccount) {
      setResult(errorResult("No wallet connected."));
      return;
    }
    setPaying(true);
    const actions: WALLET_API.STRK20_ACTION[] = [
      { type: "transfer", token: TOKEN, amount: num.toHex(amountWei), recipient: toValid },
    ];
    try {
      const r = await myWalletAccount.strk20InvokeTransaction(actions);
      const txH = r.transaction_hash;
      setResult({
        status: "pending",
        title: "Waiting for confirmation…",
        rows: [
          { label: "Amount", value: `${fmtStrk(amountWei)} STRK` },
          { label: "Transaction", value: shortHex(txH), hash: txH },
        ],
      });
      const provider = constants.myFrontendProviders[myFrontendProviderIndex];
      const txR = await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      const final = receiptToResult(txR, txH, `${fmtStrk(amountWei)} STRK`);
      setResult(final);
      if (final.status === "ok") {
        // Best-effort order bookkeeping for the merchant dashboard - never
        // blocks or fails the payment itself, which already confirmed on-chain.
        fetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: toValid,
            amount: fmtStrk(amountWei),
            token: "STRK",
            note: note ?? undefined,
            ref: ref ?? undefined,
            txHash: txH,
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
      <div className={styles.inputBlock}>
        <div className={styles.inputLabel}>Pay privately</div>
        <div className={styles.subLine}>
          <span>Shielded on the STRK20 pool</span>
        </div>
      </div>

      <div className={styles.summaryCard}>
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Pay to</span>
          <span className={styles.summaryValue}>{shortTo}</span>
        </div>
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Amount</span>
          <span className={styles.summaryValue}>
            {fixedAmount ? `${fixedAmount} STRK` : "You choose"}
          </span>
        </div>
        {note ? (
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Note</span>
            <span className={styles.summaryValue}>{note}</span>
          </div>
        ) : null}
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

      {isExpired ? (
        <div className={styles.warn} style={{ padding: "0 0 12px" }}>
          This payment link has expired. Ask the business for a fresh one.
        </div>
      ) : !fixedAmount ? (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="customAmount">
            Amount (STRK)
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

      {!isStrk20Network && isConnected ? (
        <div className={styles.warn}>
          STRK20 actions require Mainnet or Sepolia - switch your wallet network.
        </div>
      ) : null}

      {isExpired ? null : isConnected ? (
        <button className={styles.btnCta} disabled={!isStrk20Network || paying} onClick={handlePay}>
          {paying ? "Confirm in your wallet…" : "Pay privately"}
        </button>
      ) : (
        <SelectWallet variant="ctaBig" />
      )}

      {result ? <ReceiptCard result={result} providerIndex={myFrontendProviderIndex} /> : null}
    </div>
  );
}
