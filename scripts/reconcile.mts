// Finds money that reached the operating wallet but was never credited, and
// optionally credits it.
//
// Reporting a payment depends on the payer's browser reaching /api/payments.
// That is retried, survives a failed receipt poll, and can be re-supplied by
// hand — but a closed tab still ends with real funds in custody and no deposit
// row. This is the sweep that catches those.
//
// Read-only by default. --apply credits everything a single payment intent
// accounts for; anything ambiguous is listed for a human instead, because
// crediting the wrong merchant is worse than crediting neither.
//
// Usage:
//   npm run reconcile              # sepolia, report only
//   npm run reconcile -- --network 0 --apply
import { readFileSync } from "node:fs";

// npm scripts do not load .env.local, and the endpoint is authenticated —
// reading it here beats asking every operator to export it by hand.
function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // Deployed environments pass real env vars instead.
  }
  return out;
}

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const env = { ...loadEnvLocal(), ...process.env };
const secret = env.NOMOS_SHIELD_WORKER_SECRET;
if (!secret) {
  console.error("NOMOS_SHIELD_WORKER_SECRET is not set (looked in .env.local and the environment).");
  process.exit(1);
}

const base = value("host", env.RECONCILE_HOST ?? "http://localhost:3000");
const network = value("network", "2");
const apply = flag("apply");
const url = `${base}/api/internal/reconcile?network=${network}`;
const headers = { authorization: `Bearer ${secret}` };

const label = network === "0" ? "mainnet" : "sepolia";
console.log(`\nReconciling ${label} against ${base}${apply ? " (crediting)" : " (report only)"}\n`);

const survey = await fetch(url, { headers }).then((r) => r.json());
if (survey.error) {
  console.error(`  ${survey.error}`);
  process.exit(1);
}

const notes = survey.unattributedNotes ?? [];
const transfers = survey.unattributedTransfers ?? [];

if (survey.clean) {
  console.log("  Nothing unaccounted for. Every arrival has a deposit behind it.\n");
  process.exit(0);
}

console.log(`  ${notes.length} shielded note(s) and ${transfers.length} transfer(s) with no deposit`);
console.log(`  ${survey.attributable} of them match exactly one open intent\n`);
for (const n of notes) {
  console.log(`   note      ${n.amount.padEnd(14)} ${n.intentId ? `→ link ${n.linkId ?? "?"}` : "ambiguous — needs a human"}`);
}
for (const t of transfers) {
  console.log(`   transfer  ${t.amount.padEnd(14)} ${t.intentId ? `→ link ${t.linkId ?? "?"}` : "ambiguous — needs a human"}`);
}

if (!apply) {
  console.log(`\n  Re-run with --apply to credit the ${survey.attributable} attributable one(s).\n`);
  process.exit(0);
}

const result = await fetch(url, { method: "POST", headers }).then((r) => r.json());
console.log("");
for (const c of result.credited ?? []) {
  console.log(c.error ? `  ✗ ${c.txHash}: ${c.error}` : `  ✓ credited ${c.txHash} → ${c.reference}`);
}
if ((result.ambiguous ?? []).length > 0) {
  console.log(`\n  ${result.ambiguous.length} left unattributed on purpose — no single intent accounts for them.`);
}
console.log("");
