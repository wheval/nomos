// Executes a confirmed payout on-chain. Both modes are STRK20 pool actions
// (withdraw = public unshield, transfer = stays private) driven headlessly
// through @starkware-libs/starknet-privacy-sdk — screening is deposit-only
// (see docs/ARCHITECTURE.md), so neither mode is blocked by FPI.
//
// Uses the SDK's raw builder (not SimplePrivateTransfersImpl) specifically
// to pass provingBlockId explicitly — the SDK's own proving-config docs say
// to always pass it (currentBlock - 10), since omitting it "works most of
// the time" but causes intermittent "Note not mature" failures.
import { myFrontendProviders } from "@/utils/constants";
import { getOperatingAccount } from "./operatingWallet";
import { getPrivacyClient, provingBlockId, submitPrivateAction } from "./privacyClient";

export interface PayoutExecutor {
  executeWithdraw(params: { amountWei: bigint; token: string; destination: string }): Promise<{ txHash: string }>;
  executeTransfer(params: { amountWei: bigint; token: string; destination: string }): Promise<{ txHash: string }>;
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

    return submitPrivateAction(account, result);
  }

  return {
    executeWithdraw: (params) => run("withdraw", params),
    executeTransfer: (params) => run("transfer", params),
  };
}
