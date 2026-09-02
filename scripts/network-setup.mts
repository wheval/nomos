// Readiness check and one-time setup for the operating wallet on a network.
//
// Read-only by default: run it any time to see exactly what is and isn't in
// place. With --apply it performs the two on-chain steps that need doing
// once per network — declare the account class, then deploy the account.
// Registration is deliberately not here; it needs the privacy SDK and the
// per-network proving provider, so it lives behind /api/internal/register
// where the real wiring already exists rather than being duplicated.
//
// Every step is idempotent: already-declared, already-deployed and
// already-registered are detected and skipped, so re-running is safe.
//
// Self-contained (duplicates a little of src/server/signer) for the same
// reason register-operating-wallet.mts is — Node's TS runner and this SDK's
// ESM exports map don't agree, and reworking real source files to suit a
// run-once script isn't worth it. Nothing here is on the request path.
//
// Usage:
//   set -a; source .env.local; set +a
//   node scripts/network-setup.mts --network sepolia
//   node scripts/network-setup.mts --network mainnet --apply
import { readFileSync } from "node:fs";
import { Account, EthSigner, RpcProvider, Signer, hash, num } from "starknet";

const NETWORKS = {
  mainnet: {
    index: 0,
    rpc: (k: string) => `https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/${k}`,
    pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
    proverEnv: "STARKSCAN_API_KEY",
  },
  sepolia: {
    index: 2,
    rpc: (k: string) => `https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/${k}`,
    pool: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
    proverEnv: "PROVING_SERVICE_URL",
  },
} as const;

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const SIERRA = "cairo/target/dev/strk20_invoke_helper_NomosOperatingWallet.contract_class.json";
const CASM = "cairo/target/dev/strk20_invoke_helper_NomosOperatingWallet.compiled_contract_class.json";

// Recovered from the Sepolia DEPLOY_ACCOUNT transaction (see cairo/address.md).
// Salt 0 plus calldata derived from the signing key means the account lands on
// the same address on every network — which is what lets one configured
// NOMOS_OPERATING_WALLET_ADDRESS be correct for both.
const DEPLOY_SALT = "0x0";

// Setup spends STRK on declare (~12), deploy (~1) and register (~4) plus the
// pool fee, so this is the floor worth starting from rather than a precise
// total.
const RECOMMENDED_FUNDING_STRK = 25n;

// Gas actually consumed by these two transactions on Sepolia, read from their
// receipts (see cairo/address.md for the hashes). Used to size resource
// bounds directly, because starknet.js's own estimator pads its bounds so far
// past reality that the *cap* exceeds a balance the real fee fits inside
// twice over — a declare that costs ~12 STRK was rejected against 25 STRK
// for asking for a 25.8 STRK ceiling.
const MEASURED_L2_GAS = { declare: 347_386_240n, deploy: 18_910_603n };
// Bounds are a ceiling, not a charge: the fee paid is actual usage at the
// actual price. Headroom covers a busier block and a price move between
// signing and inclusion, without inflating the ceiling past the balance.
const GAS_AMOUNT_MARGIN = 13n; // /10 → 1.3x
const GAS_PRICE_MARGIN = 15n; // /10 → 1.5x

async function boundsFor(provider: RpcProvider, step: "declare" | "deploy") {
  // getBlockLatestAccepted returns only hash and number — the gas prices live
  // on the full block.
  const block = await provider.getBlockWithTxHashes("latest");
  const raw = block as unknown as {
    l2_gas_price?: { price_in_fri: string };
    l1_data_gas_price?: { price_in_fri: string };
    l1_gas_price?: { price_in_fri: string };
  };
  const price = (v?: { price_in_fri: string }) => (v ? num.toBigInt(v.price_in_fri) : 0n);
  return {
    l2_gas: {
      max_amount: (MEASURED_L2_GAS[step] * GAS_AMOUNT_MARGIN) / 10n,
      max_price_per_unit: (price(raw.l2_gas_price) * GAS_PRICE_MARGIN) / 10n,
    },
    // These two are rounding error next to l2_gas, so they get flat headroom.
    l1_gas: { max_amount: 0n, max_price_per_unit: price(raw.l1_gas_price) * 2n },
    l1_data_gas: { max_amount: 2_000n, max_price_per_unit: price(raw.l1_data_gas_price) * 2n },
  };
}

// The constructor takes an EthPublicKey — (u256 x, u256 y) — which on the
// wire is four felts: [x.low, x.high, y.low, y.high]. CallData.compile can't
// do this for us: the raw key exceeds felt252 and it throws. Verified to
// reproduce the Sepolia deploy's calldata exactly.
function ethPublicKeyCalldata(pubKey: string): string[] {
  const body = pubKey.replace(/^0x/, "");
  // Uncompressed keys may carry an 0x04 prefix byte; length distinguishes it
  // from a leading zero byte of X, which a prefix-strip would corrupt.
  const xy = body.length === 130 ? body.slice(2) : body;
  if (xy.length !== 128) throw new Error(`Unexpected public key length: ${pubKey.length}`);
  const x = BigInt(`0x${xy.slice(0, 64)}`);
  const y = BigInt(`0x${xy.slice(64)}`);
  const MASK = (1n << 128n) - 1n;
  return [x & MASK, x >> 128n, y & MASK, y >> 128n].map((v) => num.toHex(v));
}

const ok = (s: string) => `  ✓ ${s}`;
const bad = (s: string) => `  ✗ ${s}`;
const skip = (s: string) => `  · ${s}`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const network = argv[argv.indexOf("--network") + 1];
  if (!network || !(network in NETWORKS)) {
    throw new Error("Pass --network mainnet|sepolia");
  }
  return { network: network as keyof typeof NETWORKS, apply: argv.includes("--apply") };
}

async function callPool(provider: RpcProvider, pool: string, fn: string, calldata: string[] = []) {
  try {
    return await provider.callContract({ contractAddress: pool, entrypoint: fn, calldata });
  } catch {
    return null;
  }
}

async function main() {
  const { network, apply } = parseArgs();
  const cfg = NETWORKS[network];
  const provider = new RpcProvider({ nodeUrl: cfg.rpc(requireEnv("NEXT_PUBLIC_PROVIDER_URL")) });
  const address = requireEnv("NOMOS_OPERATING_WALLET_ADDRESS");

  console.log(`\nNomos — ${network} (network index ${cfg.index})`);
  console.log(`Operating wallet: ${address}\n`);

  // ── Configuration ───────────────────────────────────────────────────────
  console.log("Configuration");
  for (const name of ["NOMOS_OPERATING_WALLET_PRIVKEY", "NOMOS_OPERATING_WALLET_VIEWING_KEY", cfg.proverEnv]) {
    console.log(process.env[name] ? ok(name) : bad(`${name} is not set`));
  }

  // ── Chain state ─────────────────────────────────────────────────────────
  console.log("\nChain state");
  const sierra = JSON.parse(readFileSync(SIERRA, "utf-8"));
  const casm = JSON.parse(readFileSync(CASM, "utf-8"));
  const classHash = hash.computeContractClassHash(sierra);

  let declared = true;
  try {
    await provider.getClass(classHash, "latest");
    console.log(ok(`class declared (${classHash.slice(0, 18)}…)`));
  } catch {
    declared = false;
    console.log(bad(`class NOT declared (${classHash.slice(0, 18)}…)`));
  }

  let deployed = true;
  try {
    await provider.getClassHashAt(address, "latest");
    console.log(ok("account deployed"));
  } catch {
    deployed = false;
    console.log(bad("account NOT deployed"));
  }

  const balRaw = await provider.callContract({ contractAddress: STRK, entrypoint: "balanceOf", calldata: [address] });
  const balance = num.toBigInt(balRaw[0]) + (balRaw[1] === undefined ? 0n : num.toBigInt(balRaw[1]) << 128n);
  const balanceStrk = Number(balance) / 1e18;
  const funded = balance >= RECOMMENDED_FUNDING_STRK * 10n ** 18n;
  console.log(
    funded
      ? ok(`STRK balance ${balanceStrk.toFixed(3)}`)
      : bad(`STRK balance ${balanceStrk.toFixed(3)} — fund with at least ${RECOMMENDED_FUNDING_STRK} STRK`)
  );

  const pk = await callPool(provider, cfg.pool, "get_public_key", [address]);
  const registered = !!pk && pk.some((v) => num.toBigInt(v) !== 0n);
  console.log(registered ? ok("registered on the privacy pool") : bad("NOT registered on the privacy pool"));

  const fee = await callPool(provider, cfg.pool, "get_fee_amount");
  if (fee) console.log(skip(`pool fee ${Number(num.toBigInt(fee[0])) / 1e18} STRK per action`));

  if (declared && deployed && registered) {
    console.log(`\n${network} is fully set up.\n`);
    return;
  }

  // ── Apply ───────────────────────────────────────────────────────────────
  if (!apply) {
    console.log("\nRe-run with --apply to perform the missing steps (declare, deploy).");
    if (!registered) console.log("Registration runs separately: POST /api/internal/register {\"networkIndex\": N}.");
    console.log();
    return;
  }

  if (!funded) {
    throw new Error(
      `Refusing to spend: ${address} holds ${balanceStrk.toFixed(3)} STRK on ${network}. ` +
        `Fund it with at least ${RECOMMENDED_FUNDING_STRK} STRK first — a half-finished setup is worse than none.`
    );
  }

  const signer = new EthSigner(requireEnv("NOMOS_OPERATING_WALLET_PRIVKEY"));
  const account = new Account({ provider, address, signer, cairoVersion: "1" });

  // A DECLARE must be sent from a deployed account, and this account cannot
  // deploy until its own class is declared — so it can never bootstrap
  // itself. Some *other* already-deployed account has to publish the class
  // first, which is exactly how Sepolia was done (its DECLARE came from
  // 0x7614421a…, not from the operating wallet).
  //
  // NOMOS_DECLARER_* lets that account be supplied here. It only ever signs
  // the DECLARE; it never touches funds or the pool, and is not needed again
  // once the class exists on the network.
  const declarerAddress = process.env.NOMOS_DECLARER_ADDRESS;
  const declarerKey = process.env.NOMOS_DECLARER_PRIVKEY;

  if (!declared && !deployed && !declarerKey) {
    throw new Error(
      `Cannot bootstrap ${network}: the class is not declared, and a DECLARE has to come from an ` +
        `already-deployed account — this one cannot deploy until the class exists.\n\n` +
        `Declare it from any funded mainnet account you already control (~12 STRK), then re-run:\n` +
        `  NOMOS_DECLARER_ADDRESS=0x...  NOMOS_DECLARER_PRIVKEY=0x...  npm run setup:${network} -- --apply\n\n` +
        `That account is Stark-curve by default (Argent, Braavos, OZ); set NOMOS_DECLARER_ETH=1 if it ` +
        `signs with secp256k1. It signs the DECLARE only — it never holds or moves Nomos funds.`
    );
  }

  if (!declared) {
    console.log("\nDeclaring class…");
    const bounds = await boundsFor(provider, "declare");
    const cap = (bounds.l2_gas.max_amount * bounds.l2_gas.max_price_per_unit) / 10n ** 18n;
    console.log(`  fee ceiling ~${cap} STRK (actual charge is usage at the live price, well under this)`);

    // Declared by the supplied bootstrap account when there is one, otherwise
    // by the operating wallet itself — which is only possible once it exists.
    const declarer =
      declarerKey && declarerAddress
        ? new Account({
            provider,
            address: declarerAddress,
            signer: process.env.NOMOS_DECLARER_ETH === "1" ? new EthSigner(declarerKey) : new Signer(declarerKey),
            cairoVersion: "1",
          })
        : account;
    if (declarer !== account) console.log(`  declaring from ${declarerAddress}`);

    const res = await declarer.declareIfNot(
      { contract: sierra, casm },
      { resourceBounds: bounds } as Parameters<typeof account.declareIfNot>[1]
    );
    if (res.transaction_hash) {
      console.log(`  tx ${res.transaction_hash}`);
      await provider.waitForTransaction(res.transaction_hash);
    }
    console.log(ok(`declared ${res.class_hash}`));
  }

  if (!deployed) {
    // The constructor takes the signer's own secp256k1 public key, so the
    // address is a pure function of (class, key, salt). Verified against the
    // configured address before spending anything: deploying this to a
    // different address would strand funds at one nothing else knows about.
    const constructorCalldata = ethPublicKeyCalldata(await signer.getPubKey());
    const computed = hash.calculateContractAddressFromHash(DEPLOY_SALT, classHash, constructorCalldata, 0);
    if (num.toBigInt(computed) !== num.toBigInt(address)) {
      throw new Error(
        `Refusing to deploy: computed address ${computed} does not match the configured ` +
          `NOMOS_OPERATING_WALLET_ADDRESS ${address}. The signing key, class or salt differs from the Sepolia deploy.`
      );
    }
    console.log("\nDeploying account…");
    const res = await account.deployAccount(
      { classHash, constructorCalldata, addressSalt: DEPLOY_SALT, contractAddress: address },
      { resourceBounds: await boundsFor(provider, "deploy") } as Parameters<typeof account.deployAccount>[1]
    );
    console.log(`  tx ${res.transaction_hash}`);
    await provider.waitForTransaction(res.transaction_hash);
    console.log(ok(`deployed ${res.contract_address}`));
  }

  console.log(
    registered
      ? "\nDone.\n"
      : `\nDeclare and deploy complete. Register last:\n  POST /api/internal/register {"networkIndex": ${cfg.index}}\n`
  );
}

main().catch((err) => {
  console.error(`\n${err.message ?? err}\n`);
  process.exit(1);
});
