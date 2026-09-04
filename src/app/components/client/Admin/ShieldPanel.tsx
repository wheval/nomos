"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../../uni.module.css";
import { fmtTokenAmount, shortHex, explorerTxUrl, isOnChainHash } from "@/utils/receipt";
import { tokenDecimals, Strk20Networks, type TokenSymbol } from "@/utils/constants";
import { TokenAmount } from "../../TokenIcons";
import ExternalIcon from "../../ExternalIcon";

// The operator side of the manual shield. Flow B lands unshielded and cannot
// be shielded headlessly — every pool deposit needs an FPI screening
// signature — so a person shields the batch through their own privacy wallet
// and transfers it privately to the operating wallet. This screen is the
// half a person can't do in their head: what is waiting, what one batch adds
// up to, where it has to land, and the bookkeeping once it has.

type Deposit = {
  id: string;
  merchantAddress: string;
  networkIndex: number;
  token: string;
  amountWei: string;
  feeWei: string;
  txHash: string;
  reference: string;
  recordedAt: number;
};

type Group = { networkIndex: number; token: string; totalWei: string; depositIds: string[] };

type Pending = { operatingWallet: string | null; deposits: Deposit[]; groups: Group[] };

type MarkResult = { depositId: string; ok: boolean; error?: string };

const SECRET_KEY = "nomos.shieldWorkerSecret";

function groupKey(g: { networkIndex: number; token: string }) {
  return `${g.networkIndex}:${g.token}`;
}

function amountOf(wei: string, token: string) {
  return fmtTokenAmount(BigInt(wei), tokenDecimals(token as TokenSymbol));
}

export default function ShieldPanel() {
  const [secret, setSecret] = useState<string | null>(null);
  const [secretDraft, setSecretDraft] = useState("");
  const [data, setData] = useState<Pending | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [marking, setMarking] = useState<string | null>(null);
  const [results, setResults] = useState<MarkResult[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Session storage, not local: the secret survives a reload while the
  // operator is working and is gone when the tab closes.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SECRET_KEY);
      if (saved) setSecret(saved);
    } catch {
      /* private mode; the operator just types it again */
    }
  }, []);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/internal/shield", { headers: { Authorization: `Bearer ${key}` } });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      setData(body);
      setSelected(new Set(body.deposits.map((d: Deposit) => d.id)));
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (secret) void load(secret);
  }, [secret, load]);

  function copy(value: string, tag: string) {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(tag);
        setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1500);
      },
      () => setError("Could not copy to the clipboard.")
    );
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function markShielded(group: Group, ids: string[]) {
    const key = groupKey(group);
    const shieldTxHash = (hashes[key] ?? "").trim();
    if (!isOnChainHash(shieldTxHash)) {
      setError("Paste the hash of the private transfer into the operating wallet before marking a batch.");
      return;
    }
    setMarking(key);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/internal/shield", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ depositIds: ids, shieldTxHash }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      setResults(body.results ?? []);
      setHashes((h) => ({ ...h, [key]: "" }));
      if (secret) await load(secret);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setMarking(null);
    }
  }

  function forget() {
    try {
      sessionStorage.removeItem(SECRET_KEY);
    } catch {
      /* nothing to clear */
    }
    setSecret(null);
    setSecretDraft("");
    setData(null);
  }

  if (!secret) {
    return (
      <div className={styles.consolePage}>
        <div className={styles.cPanel}>
          <div className={styles.shieldGate}>
            <h1 className={styles.pageHeadTitle}>Shield queue</h1>
            <p className={styles.pageHeadSub}>
              Internal. Enter the shield worker secret to see what is waiting.
            </p>
            <form
              className={styles.shieldGateForm}
              onSubmit={(e) => {
                e.preventDefault();
                const key = secretDraft.trim();
                if (!key) return;
                try {
                  sessionStorage.setItem(SECRET_KEY, key);
                } catch {
                  /* not persisted; still usable for this render */
                }
                setSecret(key);
              }}
            >
              <input
                className={styles.inputMain}
                type="password"
                autoComplete="off"
                placeholder="NOMOS_SHIELD_WORKER_SECRET"
                value={secretDraft}
                onChange={(e) => setSecretDraft(e.target.value)}
              />
              <button className={`${styles.btn} ${styles.btnCta}`} type="submit" disabled={!secretDraft.trim()}>
                Unlock
              </button>
            </form>
            {error ? <p className={styles.shieldError}>{error}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  const groups = data?.groups ?? [];
  const wallet = data?.operatingWallet ?? null;

  return (
    <div className={styles.consolePage}>
      <div className={styles.cPanel}>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.pageHeadTitle}>Shield queue</h1>
            <p className={styles.pageHeadSub}>
              Public payments waiting to be shielded by hand and credited to their merchant.
            </p>
          </div>
          <div className={styles.pageHeadActions}>
            <button className={styles.btnGhost} type="button" onClick={() => secret && load(secret)} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button className={styles.btnGhost} type="button" onClick={forget}>
              Lock
            </button>
          </div>
        </div>

        <div className={styles.shieldNote}>
          <strong>Why this is manual.</strong> Every deposit into the STRK20 pool needs a screening signature from
          FPI, so Nomos cannot shield on its own. Shield each batch below through a privacy-capable wallet
          (Ready or Xverse), privately transfer the result to the operating wallet, then paste that transfer&rsquo;s
          hash here. Marking a batch credits each merchant&rsquo;s balance and fires their webhook — so only mark
          what has actually landed.
        </div>

        {error ? <p className={styles.shieldError}>{error}</p> : null}

        {results ? (
          <div className={styles.shieldResults}>
            {results.filter((r) => r.ok).length} of {results.length} marked shielded.
            {results
              .filter((r) => !r.ok)
              .map((r) => (
                <div key={r.depositId} className={styles.shieldResultBad}>
                  {shortHex(r.depositId)}: {r.error}
                </div>
              ))}
          </div>
        ) : null}

        {loading && !data ? (
          <div className={styles.emptyBox}>Loading the queue…</div>
        ) : groups.length === 0 ? (
          <div className={styles.emptyBox}>
            Nothing is waiting to be shielded. Public payments appear here the moment they are verified.
          </div>
        ) : (
          groups.map((group) => {
            const key = groupKey(group);
            const rows = (data?.deposits ?? []).filter((d) => groupKey(d) === key);
            const chosen = rows.filter((d) => selected.has(d.id));
            const chosenWei = chosen.reduce((sum, d) => sum + BigInt(d.amountWei), 0n);
            const network = Strk20Networks[group.networkIndex] ?? `NETWORK ${group.networkIndex}`;
            return (
              <section key={key} className={styles.shieldGroup}>
                <header className={styles.shieldGroupHead}>
                  <div>
                    <div className={styles.shieldGroupTitle}>
                      <TokenAmount
                        amount={fmtTokenAmount(chosenWei, tokenDecimals(group.token as TokenSymbol))}
                        symbol={group.token}
                        size={18}
                      />
                      <span className={styles.cellChip}>{network}</span>
                    </div>
                    <p className={styles.shieldGroupSub}>
                      {chosen.length} of {rows.length} selected
                      {chosen.length !== rows.length
                        ? ` · ${amountOf(group.totalWei, group.token)} ${group.token} waiting in total`
                        : ""}
                    </p>
                  </div>
                  <button
                    className={styles.btnGhost}
                    type="button"
                    onClick={() =>
                      copy(fmtTokenAmount(chosenWei, tokenDecimals(group.token as TokenSymbol)), `amt:${key}`)
                    }
                  >
                    {copied === `amt:${key}` ? "Copied" : "Copy amount"}
                  </button>
                </header>

                <div className={styles.shieldDest}>
                  <span className={styles.fieldLabel}>Shield into</span>
                  {wallet ? (
                    <>
                      <code className={styles.shieldDestValue}>{wallet}</code>
                      <button className={styles.btnGhost} type="button" onClick={() => copy(wallet, `dest:${key}`)}>
                        {copied === `dest:${key}` ? "Copied" : "Copy"}
                      </button>
                    </>
                  ) : (
                    <span className={styles.shieldError} style={{ margin: 0 }}>
                      NOMOS_OPERATING_WALLET_ADDRESS is not configured on this deployment.
                    </span>
                  )}
                </div>

                <div className={styles.tableWrap}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th style={{ width: 44 }}>
                          <input
                            type="checkbox"
                            aria-label="Select every payment in this batch"
                            checked={chosen.length === rows.length && rows.length > 0}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                for (const d of rows) {
                                  if (e.target.checked) next.add(d.id);
                                  else next.delete(d.id);
                                }
                                return next;
                              })
                            }
                          />
                        </th>
                        <th>Amount</th>
                        <th>Merchant</th>
                        <th>Paid in</th>
                        <th>Received</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((d) => (
                        <tr key={d.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select payment ${d.reference}`}
                              checked={selected.has(d.id)}
                              onChange={() => toggle(d.id)}
                            />
                          </td>
                          <td className={styles.cellStrong}>
                            {amountOf(d.amountWei, d.token)} {d.token}
                          </td>
                          <td className={styles.cellMono}>{shortHex(d.merchantAddress)}</td>
                          <td className={styles.cellMono}>
                            {isOnChainHash(d.txHash) ? (
                              <a
                                className={styles.rowTitleLink}
                                href={explorerTxUrl(d.networkIndex, d.txHash)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {shortHex(d.txHash)} <ExternalIcon />
                              </a>
                            ) : (
                              shortHex(d.txHash)
                            )}
                          </td>
                          <td className={styles.cellMuted}>
                            {new Date(d.recordedAt * 1000).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className={styles.shieldConfirm}>
                  <input
                    className={styles.inputMain}
                    placeholder="Hash of the private transfer into the operating wallet"
                    value={hashes[key] ?? ""}
                    onChange={(e) => setHashes((h) => ({ ...h, [key]: e.target.value }))}
                  />
                  <button
                    className={`${styles.btn} ${styles.btnCta}`}
                    type="button"
                    disabled={chosen.length === 0 || marking === key}
                    onClick={() => markShielded(group, chosen.map((d) => d.id))}
                  >
                    {marking === key ? "Marking…" : `Mark ${chosen.length} shielded`}
                  </button>
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
