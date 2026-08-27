// Shared wiring for @starkware-libs/starknet-privacy-sdk against the real
// STRK20 privacy pool. Both noteDiscovery.ts (Flow A verification) and
// payoutExecutor.ts (payout execution) build on this — same account, same
// pool, same proving/discovery config either way.
//
// The SDK only produces a CallAndProof (see its README's "Register/Transfer
// flow" diagrams) — broadcasting it to Starknet is left to "the wallet",
// which here is this operating-wallet signer. submitPrivateAction below is
// that submission step, following the exact recipe from the SDK's own
// proving-config docs (strk20.starknet.io/docs/sdk/proving-config):
// proofFacts must be omitted entirely (not passed as []) when empty, or
// starknet.js serializes an invalid v3 transaction; tip: 0n is mandatory.
import { constants, Contract, type Account, type ProviderInterface } from "starknet";
import {
  createPrivateTransfers,
  ProvingServiceProofProvider,
  type PrivateTransfersInterface,
  type ExecuteResult,
} from "@starkware-libs/starknet-privacy-sdk";
// ContractDiscoveryProvider only ships under the /testing export path today
// (per the SDK's own README, "Best for development and testing" — still the
// documented option for a direct-RPC discovery provider, no indexer infra).
import { ContractDiscoveryProvider } from "@starkware-libs/starknet-privacy-sdk/testing";
import { PrivacyPoolABI } from "@starkware-libs/starknet-privacy-sdk/abi";
import { getOperatingAccount } from "./operatingWallet";

// STRK20 privacy pool on Sepolia — confirmed directly against Sepolia
// Voyager (contract named "Starknet: Canonical Privacy Pool", matching the
// full protocol ABI: nullifier_exists, get_screener_public_key, etc).
export const STRK20_POOL_ADDRESS_SEPOLIA =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

let cached: PrivateTransfersInterface | undefined;

export function getPrivacyClient(provider: ProviderInterface): PrivateTransfersInterface {
  if (cached) return cached;

  const provingServiceUrl = process.env.PROVING_SERVICE_URL;
  if (!provingServiceUrl) {
    throw new Error("PROVING_SERVICE_URL is not configured.");
  }
  const viewingKeyRaw = process.env.NOMOS_OPERATING_WALLET_VIEWING_KEY;
  if (!viewingKeyRaw) {
    throw new Error("NOMOS_OPERATING_WALLET_VIEWING_KEY is not configured.");
  }

  const account = getOperatingAccount(provider);
  // .typedv2(abi) is required — a plain Contract instance's methods are
  // only dynamically added (a runtime Proxy), not statically typed, so it
  // doesn't structurally satisfy PoolContractInterface on its own.
  const poolContract = new Contract({
    abi: PrivacyPoolABI as unknown as import("starknet").Abi,
    address: STRK20_POOL_ADDRESS_SEPOLIA,
    providerOrAccount: provider,
  }).typedv2(PrivacyPoolABI);

  cached = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => BigInt(viewingKeyRaw) },
    provingProvider: new ProvingServiceProofProvider(provingServiceUrl, constants.StarknetChainId.SN_SEPOLIA),
    discoveryProvider: new ContractDiscoveryProvider(poolContract),
    poolContractAddress: STRK20_POOL_ADDRESS_SEPOLIA,
  });
  return cached;
}

// currentBlock - 10: note maturity (notes mature 10 blocks after creation)
// plus reorg buffer, per the SDK's own proving-config guidance. Always pass
// this explicitly rather than omitting it (omitting it "works most of the
// time" per the docs, with intermittent "Note not mature" failures).
export async function provingBlockId(provider: ProviderInterface): Promise<number> {
  const current = await provider.getBlockNumber();
  return current - 10;
}

// Manual resource bounds, not starknet.js's automatic fee estimation.
// account.estimateInvokeFee always simulates with SKIP_VALIDATE, so it
// never accounts for this account's own __validate__ cost — and this is an
// OZ eth-type account (secp256k1 signature verification, chosen for future
// Turnkey/AWS KMS compatibility per docs/ARCHITECTURE.md), which costs far
// more to validate on-chain than a native Stark-curve account. Confirmed
// empirically against this exact wallet: a plain ERC20 approve needed ~40M
// L2 gas to pass validate (estimator said ~2.1M); register — a larger call,
// carrying the STARK proof — needed 92.4M. Sized here with real headroom;
// tighten once a broader real-cost profile exists across all three actions.
const MANUAL_RESOURCE_BOUNDS = {
  l2_gas: { max_amount: 150_000_000n, max_price_per_unit: 60_000_000_000n },
  l1_gas: { max_amount: 0n, max_price_per_unit: 500_000_000_000_000n },
  l1_data_gas: { max_amount: 5_000n, max_price_per_unit: 2_000_000_000_000n },
};

export async function submitPrivateAction(
  account: Account,
  result: ExecuteResult
): Promise<{ txHash: string }> {
  const { call, proof } = result.callAndProof;
  const proofDetails = proof.proofFacts?.length ? { proofFacts: proof.proofFacts, proof: proof.data } : {};
  const tx = await account.execute(call, {
    tip: 0n,
    ...proofDetails,
    resourceBounds: MANUAL_RESOURCE_BOUNDS,
  } as Parameters<Account["execute"]>[1]);
  return { txHash: tx.transaction_hash };
}
