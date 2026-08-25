// Shared behavioral contract every Store implementation must satisfy.
// Invoked by memoryStore.test.ts (always) and supabaseStore.test.ts (only
// when Supabase credentials are present — see that file).
import { describe, expect, it } from "vitest";
import { InsufficientBalanceError, type Store } from "./types";

function randomAddress(): string {
  return "0x" + Math.random().toString(16).slice(2).padStart(10, "0");
}

export function runStoreContractTests(label: string, makeStore: () => Store) {
  describe(`Store contract (${label})`, () => {
    it("recordDeposit is idempotent on txHash", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      const txHash = "0x" + "a".repeat(10);
      const first = await store.recordDeposit({ merchantAddress: merchant, flow: "A", txHash, amountWei: 100n });
      const second = await store.recordDeposit({ merchantAddress: merchant, flow: "A", txHash, amountWei: 100n });
      expect(first.alreadyExisted).toBe(false);
      expect(second.alreadyExisted).toBe(true);
      expect(second.deposit.id).toBe(first.deposit.id);
    });

    it("credits and debits keep an accurate running balance", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      await store.creditLedger({ merchantAddress: merchant, amountWei: 500n, token: "STRK", kind: "flow_a_deposit" });
      const afterCredit = await store.getLedgerBalance(merchant, "STRK");
      expect(afterCredit).toBe(500n);

      await store.debitLedger({ merchantAddress: merchant, amountWei: 200n, token: "STRK", kind: "payout" });
      const afterDebit = await store.getLedgerBalance(merchant, "STRK");
      expect(afterDebit).toBe(300n);
    });

    it("keeps balances for different tokens separate", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      await store.creditLedger({ merchantAddress: merchant, amountWei: 500n, token: "STRK", kind: "flow_a_deposit" });
      await store.creditLedger({ merchantAddress: merchant, amountWei: 25n, token: "USDC", kind: "flow_a_deposit" });
      expect(await store.getLedgerBalance(merchant, "STRK")).toBe(500n);
      expect(await store.getLedgerBalance(merchant, "USDC")).toBe(25n);
    });

    it("refuses to debit past zero", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      await store.creditLedger({ merchantAddress: merchant, amountWei: 50n, token: "STRK", kind: "flow_a_deposit" });
      await expect(
        store.debitLedger({ merchantAddress: merchant, amountWei: 51n, token: "STRK", kind: "payout" })
      ).rejects.toBeInstanceOf(InsufficientBalanceError);
      // Balance must be unchanged after the rejected debit.
      expect(await store.getLedgerBalance(merchant, "STRK")).toBe(50n);
    });

    it("a merchant with no ledger activity has a zero balance", async () => {
      const store = makeStore();
      expect(await store.getLedgerBalance(randomAddress(), "STRK")).toBe(0n);
    });

    it("tracks deposits through pending_shield -> shielded", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      const txHash = "0x" + "b".repeat(10);
      const { deposit } = await store.recordDeposit({
        merchantAddress: merchant,
        flow: "B",
        txHash,
        amountWei: 42n,
        status: "pending_shield",
      });
      expect((await store.listPendingShieldDeposits()).some((d) => d.id === deposit.id)).toBe(true);

      await store.markDepositShielded(deposit.id, "0x" + "c".repeat(10));
      const updated = await store.getDepositByTxHash(txHash);
      expect(updated?.status).toBe("shielded");
      expect(updated?.shieldTxHash).toBe("0x" + "c".repeat(10));
      expect((await store.listPendingShieldDeposits()).some((d) => d.id === deposit.id)).toBe(false);
    });

    it("issues a merchant key pair and verifies the secret", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      const { publicKey, secretKey } = await store.issueMerchantKey(merchant);
      expect(await store.getMerchantPublicKey(merchant)).toBe(publicKey);
      expect(await store.verifyMerchantSecret(merchant, secretKey)).toBe(true);
      expect(await store.verifyMerchantSecret(merchant, "wrong-key")).toBe(false);
    });

    it("creates a payout and lists it for the merchant", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      const payout = await store.createPayout({
        merchantAddress: merchant,
        destination: randomAddress(),
        amountWei: 10n,
        token: "STRK",
        mode: "withdraw",
      });
      expect(payout.status).toBe("pending");
      await store.updatePayoutStatus(payout.id, "confirmed", "0x" + "d".repeat(10));
      const list = await store.listPayoutsFor(merchant);
      expect(list).toHaveLength(1);
      expect(list[0].status).toBe("confirmed");
      expect(list[0].txHash).toBe("0x" + "d".repeat(10));
    });
  });
}
