// Executes a confirmed payout on-chain. Both modes are STRK20 pool actions
// (withdraw = public unshield, transfer = stays private) driven headlessly
// through @starkware-libs/starknet-privacy-sdk — screening is deposit-only
// (see docs/ARCHITECTURE.md), so neither mode is blocked by FPI.
//
// Uses the SDK's raw builder (not SimplePrivateTransfersImpl) specifically
// to pass provingBlockId explicitly — the SDK's own proving-config docs say
// to always pass it (currentBlock - 10), since omitting it "works most of
// the time" but causes intermittent "Note not mature" failures.
import { addrSTRK, myFrontendProviders } from "@/utils/constants";
import { num } from "starknet";
import type { ProviderInterface } from "starknet";
import { getOperatingAccount } from "./operatingWallet";
import { ensurePoolAllowance, getPrivacyClient, poolFeeAmount, provingBlockId, submitPrivateAction } from "./privacyClient";

export interface PayoutExecutor {
  executeWithdraw(params: { amountWei: bigint; token: string; destination: string }): Promise<{ txHash: string }>;
  executeTransfer(params: { amountWei: bigint; token: string; destination: string }): Promise<{ txHash: string }>;
}

// A payout costs STRK twice over: the pool's own per-apply_actions fee, and
// v3 transaction gas. An empty operating wallet fails deep inside proving or
// on-chain, with nothing that names the actual cause — so check first and say
// what to top up. Read live, since the pool fee tracks a USD target and moves
// with the STRK price.
async function assertCanPayFees(
  provider: ProviderInterface,
  networkIndex: number,
  operatingAddress: string
): Promise<void> {
  const [fee, balance] = await Promise.all([
    poolFeeAmount(provider, networkIndex),
    provider
      .callContract({ contractAddress: addrSTRK, entrypoint: "balanceOf", calldata: [operatingAddress] })
      .then(([low, high]) => num.toBigInt(low) + (high === undefined ? 0n : num.toBigInt(high) << 128n)),
  ]);

  if (balance >= fee) return;
  const strk = (v: bigint) => `${Number(v) / 1e18} STRK`;
  throw new Error(
    `Operating wallet ${operatingAddress} holds ${strk(balance)} on network index ${networkIndex}, ` +
      `below the pool's ${strk(fee)} fee per payout (plus gas). Top it up before retrying.`
  );
}

// Network-agnostic now: pool address, chain id and proving URL are all
// resolved per-network inside privacyClient.ts, so mainnet needs configuration
// rather than a code change. What is still missing is config, not wiring —
// the mainnet pool address and proving URL — and each throws a named error
// naming the variable to set. The operating wallet must also be deployed on
// the target network; if it isn't, the invoke fails on-chain rather than here.
export function getPayoutExecutor(networkIndex: number): PayoutExecutor {
  const provider = myFrontendProviders[networkIndex];
  if (!provider) {
    throw new Error(`No RPC provider configured for network index ${networkIndex}.`);
  }

  async function run(
    mode: "withdraw" | "transfer",
    params: { amountWei: bigint; token: string; destination: string }
  ): Promise<{ txHash: string }> {
    const account = getOperatingAccount(provider, networkIndex);
    await assertCanPayFees(provider, networkIndex, account.address);
    // Same reason as registration: the pool pulls its fee, and without an
    // allowance the payout reverts after paying gas for the privilege.
    await ensurePoolAllowance(account, provider, networkIndex);
    const transfers = getPrivacyClient(provider, networkIndex);
    const blockId = await provingBlockId(provider);

    const tokenKey = BigInt(params.token);
    const recipientKey = BigInt(params.destination);

    const result = await transfers
      .build({
        autoDiscover: { notes: "refresh", channels: "refresh" },
        autoSelectNotes: "naive",
        provingBlockId: blockId,
      })
      .with(tokenKey, (t) =>
        mode === "withdraw"
          ? t.withdraw({ recipient: recipientKey, amount: params.amountWei })
          : t.transfer({ recipient: recipientKey, amount: params.amountWei })
      )
      .surplusTo(BigInt(account.address))
      .execute();

    return submitPrivateAction(account, result, provider);
  }

  return {
    executeWithdraw: (params) => run("withdraw", params),
    executeTransfer: (params) => run("transfer", params),
  };
}
