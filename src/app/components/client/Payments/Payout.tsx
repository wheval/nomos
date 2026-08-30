"use client";

import { useEffect, useState } from "react";
import styles from "../../../uni.module.css";
import { explorerTxUrl, fmtTokenAmount, shortHex } from "@/utils/receipt";
import { parseTokenAmount } from "@/utils/payments";
import { TokenSymbols, tokenDecimals, type TokenSymbol } from "@/utils/constants";
import { TokenAmount } from "../../TokenIcons";
import { useFrontendProvider } from "../provider/providerContext";
import type { Payout as PayoutRecord, PayoutMode } from "@/server/store";
import type { TokenBalances } from "./useLedger";

type WirePayout = Omit<PayoutRecord, "amountWei"> & { amountWei: string };

// Merchant-initiated withdrawal against their ledger balance - either a
// public unshield ("withdraw", e.g. to cash out to an exchange) or a
// private transfer ("transfer", stays shielded if the merchant has their
// own privacy wallet). See docs/ARCHITECTURE.md "Custody & signing" for
// why this goes through Nomos's operating wallet rather than the merchant
// signing directly.
export default function Payout({
  merchantAddress,
  secretKey,
  balances,
  onPaidOut,
}: {
  merchantAddress: string;
  secretKey: string | null;
  balances: TokenBalances;
  onPaidOut: () => void;
}) {
  const myFrontendProviderIndex = useFrontendProvider((state) => state.currentFrontendProviderIndex);

  const [token, setToken] = useState<TokenSymbol>("STRK");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PayoutMode>("withdraw");
  const balanceWei = balances[token];
  const decimals = tokenDecimals(token);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<WirePayout[] | null>(null);

  useEffect(() => {
    if (!merchantAddress) return;
    fetch(`/api/payouts?to=${merchantAddress}&network=${myFrontendProviderIndex}`, {
      credentials: "include",
      headers: secretKey ? { Authorization: `Bearer ${secretKey}` } : {},
    })
      .then((r) => (r.ok ? r.json() : { payouts: [] }))
      .then((d) => setPayouts(d.payouts ?? []))
      .catch(() => {});
  }, [merchantAddress, secretKey, lastTxHash, myFrontendProviderIndex]);

  async function handlePayout() {
    setError("");
    setLastTxHash(null);
    const amountWei = parseTokenAmount(amount, decimals);
    if (amountWei === null) {
      setError("Enter a positive amount, e.g. 25 or 12.5");
      return;
    }
    if (amountWei > BigInt(balanceWei)) {
      setError(`Amount exceeds your balance (${fmtTokenAmount(BigInt(balanceWei), decimals)} ${token}).`);
      return;
    }
    const normalizedDestination = destination.trim();
    if (!normalizedDestination) {
      setError("Enter a destination address.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          merchantAddress,
          ...(secretKey ? { secretKey } : {}),
          networkIndex: myFrontendProviderIndex,
          destination: normalizedDestination,
          amountWei: amountWei.toString(),
          token,
          mode,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setLastTxHash(d.txHash);
      setAmount("");
      setDestination("");
      onPaidOut();
    } catch (e: any) {
      setError(e.message ?? "Payout failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>Withdraw</span>
      </div>
      <p className={styles.sectionSub}>
        Send from your balance ({fmtTokenAmount(BigInt(balanceWei), decimals)} {token} available) to any address.
      </p>

      <div className={styles.field} style={{ marginBottom: 10 }}>
        <label className={styles.fieldLabel}>Token</label>
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

      <div className={styles.field} style={{ marginBottom: 10 }}>
        <label className={styles.fieldLabel} htmlFor="payoutDestination">Destination address</label>
        <input
          id="payoutDestination"
          className={styles.textInput}
          placeholder="0x..."
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        />
      </div>

      <div className={styles.field} style={{ marginBottom: 10 }}>
        <label className={styles.fieldLabel} htmlFor="payoutAmount">Amount ({token})</label>
        <input
          id="payoutAmount"
          className={styles.textInput}
          placeholder="e.g. 25"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <div className={styles.field} style={{ marginBottom: 10 }}>
        <label className={styles.fieldLabel}>How should it settle?</label>
        <div className={styles.chipRow}>
          <button
            type="button"
            className={`${styles.chip} ${mode === "withdraw" ? styles.chipActive : ""}`}
            onClick={() => setMode("withdraw")}
          >
            Public (unshield)
          </button>
          <button
            type="button"
            className={`${styles.chip} ${mode === "transfer" ? styles.chipActive : ""}`}
            onClick={() => setMode("transfer")}
          >
            Private (stays shielded)
          </button>
        </div>
        <p className={styles.sectionSub} style={{ margin: "8px 0 0" }}>
          {mode === "withdraw"
            ? "Lands as a normal public balance at the destination — use this to cash out."
            : "Stays shielded — the destination needs its own privacy-capable wallet already registered on STRK20."}
        </p>
      </div>

      {error ? <div className={styles.errorText}>{error}</div> : null}

      <button className={`${styles.btn} ${styles.btnGreen} ${styles.btnBlock}`} disabled={submitting} onClick={handlePayout}>
        {submitting ? "Sending…" : "Withdraw"}
      </button>

      {lastTxHash ? (
        <p className={styles.sectionSub} style={{ margin: "12px 0 0" }}>
          Sent —{" "}
          <a href={explorerTxUrl(myFrontendProviderIndex, lastTxHash)} target="_blank" rel="noreferrer">
            {shortHex(lastTxHash)} ↗
          </a>
        </p>
      ) : null}

      {payouts && payouts.length > 0 ? (
        <div className={styles.txTable} style={{ marginTop: 16 }}>
          {payouts.map((p) => (
            <div key={p.id} className={styles.txRow}>
              <div className={styles.txMain}>
                <div className={styles.txTitle}>{p.mode === "withdraw" ? "Public withdrawal" : "Private transfer"}</div>
                <div className={styles.txTime}>{new Date(p.createdAt * 1000).toLocaleString()}</div>
              </div>
              <div className={styles.txAmount}>
                {fmtTokenAmount(BigInt(p.amountWei), tokenDecimals(p.token as TokenSymbol))} {p.token}
              </div>
              {p.txHash ? (
                <a className={styles.txLink} href={explorerTxUrl(myFrontendProviderIndex, p.txHash)} target="_blank" rel="noreferrer">
                  {shortHex(p.txHash)} ↗
                </a>
              ) : (
                <span className={styles.txLink}>{p.status}</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
