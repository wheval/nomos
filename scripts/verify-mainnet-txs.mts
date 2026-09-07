// Checks the hashes in strk20.json the way the sprint panel says it will:
// each must exist, have succeeded, and have touched the STRK20 pool.
//
//   node scripts/verify-mainnet-txs.mts            # verify what is in strk20.json
//   node scripts/verify-mainnet-txs.mts 0xabc…     # verify a hash before adding it
import { readFileSync } from "node:fs";
import { RpcProvider, num } from "starknet";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) {
    process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const POOL = num.toBigInt(
  process.env.STRK20_POOL_ADDRESS_MAINNET ??
    "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"
);
const provider = new RpcProvider({
  nodeUrl:
    "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/" +
    process.env.NEXT_PUBLIC_PROVIDER_URL,
});

const fromArgs = process.argv.slice(2);
const hashes: string[] = fromArgs.length
  ? fromArgs
  : JSON.parse(readFileSync("strk20.json", "utf8")).transactions;

if (hashes.length === 0) {
  console.log("No transactions to check. strk20.json needs at least three.");
  process.exit(1);
}

let good = 0;
for (const hash of hashes) {
  try {
    const receipt = (await provider.getTransactionReceipt(hash)) as never as {
      execution_status?: string;
      block_number?: number;
      events?: { from_address: string }[];
      value?: { execution_status?: string; block_number?: number; events?: { from_address: string }[] };
    };
    const r = receipt.value ?? receipt;
    const succeeded = r.execution_status === "SUCCEEDED";
    const poolEvents = (r.events ?? []).filter((e) => num.toBigInt(e.from_address) === POOL).length;
    const ok = succeeded && poolEvents > 0;
    if (ok) good += 1;
    console.log(
      `${ok ? "OK  " : "BAD "} ${hash}\n     block ${r.block_number} · ${r.execution_status} · ${poolEvents} pool event(s)`
    );
  } catch (err) {
    console.log(`BAD  ${hash}\n     not found on mainnet: ${(err as Error).message.slice(0, 80)}`);
  }
}

console.log(`\n${good} of ${hashes.length} usable; the sprint needs at least three.`);
process.exit(good >= 3 ? 0 : 1);
