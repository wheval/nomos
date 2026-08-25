// Executes a confirmed payout on-chain. Both modes are STRK20 pool
// actions (withdraw = public unshield, transfer = stays private) and need
// the @starkware-libs/starknet-privacy-sdk's proving flow — unlike the
// ordinary invokes in operatingWallet.ts. Dependency-injected via this
// interface, same reasoning as src/utils/verifyTx.ts's NoteDiscoveryClient:
// lets the payout route's business logic (auth, balance check, ledger
// debit, status tracking) be built and tested today without a resolved
// Sepolia proving-service URL. See docs/ARCHITECTURE.md.
export interface PayoutExecutor {
  executeWithdraw(params: { amountWei: bigint; token: string; destination: string }): Promise<{ txHash: string }>;
  executeTransfer(params: { amountWei: bigint; token: string; destination: string }): Promise<{ txHash: string }>;
}

export function getPayoutExecutor(): PayoutExecutor {
  return {
    async executeWithdraw() {
      throw new Error(
        "Payout execution needs the privacy SDK wired with a resolved proving-service URL " +
          "(PROVING_SERVICE_URL not yet configured). See docs/ARCHITECTURE.md."
      );
    },
    async executeTransfer() {
      throw new Error(
        "Payout execution needs the privacy SDK wired with a resolved proving-service URL " +
          "(PROVING_SERVICE_URL not yet configured). See docs/ARCHITECTURE.md."
      );
    },
  };
}
