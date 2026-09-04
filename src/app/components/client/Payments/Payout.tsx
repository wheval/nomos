"use client";
import { minimumPayoutWei, payoutFeeWei } from "@/utils/fees";

import { useEffect, useState } from "react";
import styles from "../../../uni.module.css";
import { explorerTxUrl, fmtTokenAmount, shortHex } from "@/utils/receipt";
import { parseTokenAmount } from "@/utils/payments";
import { TokenSymbols, tokenDecimals, type TokenSymbol } from "@/utils/constants";
import { TokenAmount } from "../../TokenIcons";
import { pillClass, type Tone } from "./statusTone";
import { useFrontendProvider } from "../provider/providerContext";
import type { Payout as PayoutRecord, PayoutMode } from "@/server/store";
import type { TokenBalances } from "./useLedger";
import ExternalIcon from "../../ExternalIcon";

type WirePayout = Omit<PayoutRecord, "amountWei"> & { amountWei: string };

// Merchant-initiated withdrawal against their ledger balance - either a
// public unshield ("withdraw", e.g. to cash out to an exchange) or a
// private transfer ("transfer", stays shielded if the merchant has their
// own privacy wallet). See docs/ARCHITECTURE.md "Custody & signing" for
// why this goes through Nomos's operating wallet rather than the merchant
// signing directly.
function payoutTone(status: string): Tone {
  if (status === "sent" || status === "confirmed") return "ok";
  if (status === "failed") return "bad";
  return "warn"; // pending, submitted
}

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
  const feeWei = payoutFeeWei(token);
  const minimumPayout = minimumPayoutWei(token);
  // What actually arrives: the fee comes out of the amount requested, like a
  // bank transfer charge, so show it before they commit rather than leaving
  // them to work out why the destination received less.
  const parsedAmount = parseTokenAmount(amount, decimals);
  const receiveWei = parsedAmount !== null && parsedAmount > feeWei ? parsedAmount - feeWei : null;
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
    // Mirrors the server's rule rather than replacing it — this is only here
    // so the merchant learns before a round trip, not as the enforcement.
    if (amountWei < minimumPayout) {
      setError(`Minimum withdrawal is ${fmtTokenAmount(minimumPayout, decimals)} ${token}.`);
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
    <div className={styles.cPanel}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageHeadTitle}>Payouts</h1>
          <p className={styles.pageHeadSub}>Withdraw from your balance, publicly or privately.</p>
        </div>
        <div className={styles.pageHeadActions}>
          <span
            className={styles.metricCard}
            style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 2 }}
          >
            <span className={styles.metricLabel} style={{ marginBottom: 0 }}>Available</span>
            <span className={styles.metricValue} style={{ fontSize: 18 }}>
              <TokenAmount amount={fmtTokenAmount(BigInt(balanceWei), decimals)} symbol={token} />
            </span>
          </span>
        </div>
      </div>

      <div className={styles.pageBody} style={{ maxWidth: 640 }}>
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

      <div className={styles.settingsField}>
        <label className={styles.settingsLabel} htmlFor="payoutDestination">Destination address</label>
        <input
          id="payoutDestination"
          className={styles.settingsInput}
          placeholder="0x..."
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        />
      </div>

      <div className={styles.settingsField}>
        <label className={styles.settingsLabel} htmlFor="payoutAmount">Amount ({token})</label>
        <input
          id="payoutAmount"
          className={styles.settingsInput}
          placeholder="e.g. 25"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <p className={styles.settingsHint}>
          {receiveWei !== null
            ? `${fmtTokenAmount(feeWei, decimals)} ${token} payout fee — ${fmtTokenAmount(receiveWei, decimals)} ${token} reaches the destination.`
            : `Minimum ${fmtTokenAmount(minimumPayout, decimals)} ${token}, less a ${fmtTokenAmount(feeWei, decimals)} ${token} payout fee. Withdraw in batches to pay it less often.`}
        </p>
      </div>

      <div className={styles.settingsField}>
        <label className={styles.settingsLabel}>How should it settle?</label>
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
        <p className={styles.settingsHint}>
          {mode === "withdraw"
            ? "Lands as a normal public balance at the destination — use this to cash out."
            : "Stays shielded — the destination needs its own privacy-capable wallet already registered on STRK20."}
        </p>
      </div>

      {error ? <div className={styles.errorText}>{error}</div> : null}

      <button className={styles.settingsBtn} disabled={submitting} onClick={handlePayout}>
        {submitting ? "Sending…" : "Withdraw"}
      </button>

      {lastTxHash ? (
        <p className={styles.settingsHint}>
          Sent —{" "}
          <a href={explorerTxUrl(myFrontendProviderIndex, lastTxHash)} target="_blank" rel="noreferrer">
            {shortHex(lastTxHash)} <ExternalIcon />
          </a>
        </p>
      ) : null}

      {payouts && payouts.length > 0 ? (
        <>
          <h2 className={styles.detailSectionTitle}>Payout history</h2>
          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Settlement</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td className={styles.cellStrong}>
                      <TokenAmount
                        amount={fmtTokenAmount(BigInt(p.amountWei), tokenDecimals(p.token as TokenSymbol))}
                        symbol={p.token}
                      />
                    </td>
                    <td>
                      <span className={styles.cellChip}>
                        {p.mode === "withdraw" ? "Public" : "Private"}
                      </span>
                    </td>
                    <td>
                      <span className={pillClass(payoutTone(p.status))}>{p.status}</span>
                    </td>
                    <td className={styles.cellMuted}>{new Date(p.createdAt * 1000).toLocaleString()}</td>
                    <td>
                      {p.txHash ? (
                        <a
                          className={styles.txLink}
                          href={explorerTxUrl(myFrontendProviderIndex, p.txHash)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shortHex(p.txHash)} <ExternalIcon />
                        </a>
                      ) : (
                        <span className={styles.cellMuted}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      </div>
    </div>
  );
}
