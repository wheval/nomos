// One-time: registers the operating wallet's viewing key on the real
// Sepolia STRK20 privacy pool. Must run once before any Flow A
// verification or private payout can work — see docs/ARCHITECTURE.md.
//
// Self-contained (duplicates src/server/signer/privacyClient.ts's wiring)
// rather than importing across the repo: Node's native TS runner needs
// full explicit .ts extensions through the whole relative-import graph,
// and tsx has an unrelated resolution bug against this SDK's ESM-only
// exports map. Not worth reworking real source files for a run-once script.
//
// Usage (env must already be loaded, e.g. `set -a; source .env.local; set +a`):
//   node scripts/register-operating-wallet.mts
import { Account, Contract, EthSigner, RpcProvider, constants } from "starknet";
import { createPrivateTransfers, ProvingServiceProofProvider } from "@starkware-libs/starknet-privacy-sdk";
import { ContractDiscoveryProvider } from "@starkware-libs/starknet-privacy-sdk/testing";
import { PrivacyPoolABI } from "@starkware-libs/starknet-privacy-sdk/abi";

const POOL_ADDRESS = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function main() {
  const provider = new RpcProvider({
    nodeUrl: "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/" + requireEnv("NEXT_PUBLIC_PROVIDER_URL"),
  });

  const account = new Account({
    provider,
    address: requireEnv("NOMOS_OPERATING_WALLET_ADDRESS"),
    signer: new EthSigner(requireEnv("NOMOS_OPERATING_WALLET_PRIVKEY")),
    cairoVersion: "1",
  });
  console.log("Operating wallet:", account.address);

  const poolContract = new Contract({
    abi: PrivacyPoolABI as unknown as import("starknet").Abi,
    address: POOL_ADDRESS,
    providerOrAccount: provider,
  }).typedv2(PrivacyPoolABI);

  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => BigInt(requireEnv("NOMOS_OPERATING_WALLET_VIEWING_KEY")) },
    provingProvider: new ProvingServiceProofProvider(requireEnv("PROVING_SERVICE_URL"), constants.StarknetChainId.SN_SEPOLIA),
    discoveryProvider: new ContractDiscoveryProvider(poolContract),
    poolContractAddress: POOL_ADDRESS,
  });

  const currentBlock = await provider.getBlockNumber();
  const provingBlockId = currentBlock - 10;
  console.log("Proving at block:", provingBlockId);

  const result = await transfers.build({ provingBlockId }).register().execute();

  const { call, proof } = result.callAndProof;
  const proofDetails = proof.proofFacts?.length ? { proofFacts: proof.proofFacts, proof: proof.data } : {};
  // starknet.js's automatic fee estimation uses SKIP_VALIDATE, so it never
  // accounts for this account's __validate__ cost — and this is an OZ
  // eth-type account (secp256k1 signature verification), which is far more
  // expensive to validate on-chain than a native Stark-curve account.
  // Confirmed empirically on this exact wallet/call: register's real L2 gas
  // usage was 92,375,640 (a prior attempt with a 25M bound failed with the
  // exact figure in the error). Sized here with ~15% headroom above that.
  const tx = await account.execute(call, {
    tip: 0n,
    ...proofDetails,
    resourceBounds: {
      l2_gas: { max_amount: 106_000_000n, max_price_per_unit: 60_000_000_000n },
      l1_gas: { max_amount: 0n, max_price_per_unit: 500_000_000_000_000n },
      l1_data_gas: { max_amount: 5_000n, max_price_per_unit: 2_000_000_000_000n },
    },
  } as Parameters<Account["execute"]>[1]);

  console.log("Register tx submitted:", tx.transaction_hash);
  console.log(`https://sepolia.voyager.online/tx/${tx.transaction_hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
