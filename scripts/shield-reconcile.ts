// Manual shield reconciliation CLI. Run after actually shielding pending
// Flow B deposits by hand (through a real privacy-capable wallet — see
// docs/ARCHITECTURE.md for why this can't be automated) and privately
// transferring the result into the operating wallet.
//
// Usage:
//   npx tsx scripts/shield-reconcile.ts list
//   npx tsx scripts/shield-reconcile.ts mark <shieldTxHash> <depositId> [depositId...]
//
// Requires NOMOS_APP_URL (defaults to http://localhost:3000) and
// NOMOS_SHIELD_WORKER_SECRET in the environment.
const BASE_URL = process.env.NOMOS_APP_URL ?? "http://localhost:3000";
const SECRET = process.env.NOMOS_SHIELD_WORKER_SECRET;

if (!SECRET) {
  console.error("Set NOMOS_SHIELD_WORKER_SECRET in your environment first.");
  process.exit(1);
}

async function list() {
  const res = await fetch(`${BASE_URL}/api/internal/shield`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Error:", data.error ?? res.statusText);
    process.exit(1);
  }
  if (data.deposits.length === 0) {
    console.log("Nothing pending shield.");
    return;
  }
  console.log(`${data.deposits.length} deposit(s) pending shield, ${data.totalWei} wei total:\n`);
  for (const d of data.deposits) {
    console.log(`  ${d.id}  merchant=${d.merchantAddress}  amountWei=${d.amountWei}  txHash=${d.txHash}`);
  }
}

async function mark(shieldTxHash: string, depositIds: string[]) {
  const res = await fetch(`${BASE_URL}/api/internal/shield`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ shieldTxHash, depositIds }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Error:", data.error ?? res.statusText);
    process.exit(1);
  }
  for (const r of data.results) {
    console.log(r.ok ? `  ✓ ${r.depositId}` : `  ✗ ${r.depositId}: ${r.error}`);
  }
}

const [, , cmd, ...args] = process.argv;

if (cmd === "list") {
  list();
} else if (cmd === "mark") {
  const [shieldTxHash, ...depositIds] = args;
  if (!shieldTxHash || depositIds.length === 0) {
    console.error("Usage: shield-reconcile.ts mark <shieldTxHash> <depositId> [depositId...]");
    process.exit(1);
  }
  mark(shieldTxHash, depositIds);
} else {
  console.error("Usage: shield-reconcile.ts list | mark <shieldTxHash> <depositId...>");
  process.exit(1);
}
