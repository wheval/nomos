// Shared behavioral contract every Store implementation must satisfy.
// Invoked by memoryStore.test.ts (always) and supabaseStore.test.ts (only
// when Supabase credentials are present — see that file).
import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { InsufficientBalanceError, type Store } from "./types";

const TEST_NET = 2; // Sepolia, per constants.ts's myFrontendProviders convention
const LIVE_NET = 0; // Mainnet

function randomAddress(): string {
  return "0x" + Math.random().toString(16).slice(2).padStart(10, "0");
}

export function runStoreContractTests(label: string, makeStore: () => Store) {
  describe(`Store contract (${label})`, () => {
    it("recordDeposit is idempotent on txHash", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      const txHash = "0x" + "a".repeat(10);
      const first = await store.recordDeposit({ merchantAddress: merchant, networkIndex: TEST_NET, flow: "A", txHash, amountWei: 100n });
      const second = await store.recordDeposit({ merchantAddress: merchant, networkIndex: TEST_NET, flow: "A", txHash, amountWei: 100n });
      expect(first.alreadyExisted).toBe(false);
      expect(second.alreadyExisted).toBe(true);
      expect(second.deposit.id).toBe(first.deposit.id);
    });

    it("credits and debits keep an accurate running balance", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      await store.creditLedger({ merchantAddress: merchant, networkIndex: TEST_NET, amountWei: 500n, token: "STRK", kind: "flow_a_deposit" });
      const afterCredit = await store.getLedgerBalance(merchant, "STRK", TEST_NET);
      expect(afterCredit).toBe(500n);

      await store.debitLedger({ merchantAddress: merchant, networkIndex: TEST_NET, amountWei: 200n, token: "STRK", kind: "payout" });
      const afterDebit = await store.getLedgerBalance(merchant, "STRK", TEST_NET);
      expect(afterDebit).toBe(300n);
    });

    it("keeps balances for different tokens separate", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      await store.creditLedger({ merchantAddress: merchant, networkIndex: TEST_NET, amountWei: 500n, token: "STRK", kind: "flow_a_deposit" });
      await store.creditLedger({ merchantAddress: merchant, networkIndex: TEST_NET, amountWei: 25n, token: "USDC", kind: "flow_a_deposit" });
      expect(await store.getLedgerBalance(merchant, "STRK", TEST_NET)).toBe(500n);
      expect(await store.getLedgerBalance(merchant, "USDC", TEST_NET)).toBe(25n);
    });

    it("keeps balances for different networks separate, same merchant and token", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      await store.creditLedger({ merchantAddress: merchant, networkIndex: TEST_NET, amountWei: 500n, token: "STRK", kind: "flow_a_deposit" });
      await store.creditLedger({ merchantAddress: merchant, networkIndex: LIVE_NET, amountWei: 7n, token: "STRK", kind: "flow_a_deposit" });
      expect(await store.getLedgerBalance(merchant, "STRK", TEST_NET)).toBe(500n);
      expect(await store.getLedgerBalance(merchant, "STRK", LIVE_NET)).toBe(7n);
    });

    it("refuses to debit past zero", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      await store.creditLedger({ merchantAddress: merchant, networkIndex: TEST_NET, amountWei: 50n, token: "STRK", kind: "flow_a_deposit" });
      await expect(
        store.debitLedger({ merchantAddress: merchant, networkIndex: TEST_NET, amountWei: 51n, token: "STRK", kind: "payout" })
      ).rejects.toBeInstanceOf(InsufficientBalanceError);
      // Balance must be unchanged after the rejected debit.
      expect(await store.getLedgerBalance(merchant, "STRK", TEST_NET)).toBe(50n);
    });

    it("a merchant with no ledger activity has a zero balance", async () => {
      const store = makeStore();
      expect(await store.getLedgerBalance(randomAddress(), "STRK", TEST_NET)).toBe(0n);
    });

    it("tracks deposits through pending_shield -> shielded", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      const txHash = "0x" + "b".repeat(10);
      const { deposit } = await store.recordDeposit({
        merchantAddress: merchant,
        networkIndex: TEST_NET,
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
      const { publicKey, secretKey } = await store.issueMerchantKey(merchant, TEST_NET);
      expect(await store.getMerchantPublicKey(merchant, TEST_NET)).toBe(publicKey);
      expect(await store.verifyMerchantSecret(merchant, secretKey, TEST_NET)).toBe(true);
      expect(await store.verifyMerchantSecret(merchant, "wrong-key", TEST_NET)).toBe(false);
    });

    it("stores a business name and IP allowlist on the merchant profile", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      await store.setMerchantDisplayName(merchant, TEST_NET, "Sendpay");
      await store.setMerchantAllowedIps(merchant, TEST_NET, ["1.2.3.4"]);
      const profile = await store.getMerchantProfile(merchant, TEST_NET);
      expect(profile.displayName).toBe("Sendpay");
      expect(profile.allowedIps).toEqual(["1.2.3.4"]);
      expect(profile.logoDataUrl).toBeNull();
      await store.setMerchantLogo(merchant, TEST_NET, "data:image/png;base64,abc");
      expect((await store.getMerchantProfile(merchant, TEST_NET)).logoDataUrl).toBe("data:image/png;base64,abc");
      const live = await store.getMerchantProfile(merchant, LIVE_NET);
      expect(live.displayName).toBeNull();
      expect(live.allowedIps).toEqual([]);
    });

    it("keeps test and live API keys entirely separate for the same merchant", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      const testKeys = await store.issueMerchantKey(merchant, TEST_NET);
      const liveKeys = await store.issueMerchantKey(merchant, LIVE_NET);
      expect(testKeys.secretKey).not.toBe(liveKeys.secretKey);
      // A test-mode secret must never authenticate a live-mode request, and vice versa.
      expect(await store.verifyMerchantSecret(merchant, testKeys.secretKey, LIVE_NET)).toBe(false);
      expect(await store.verifyMerchantSecret(merchant, liveKeys.secretKey, TEST_NET)).toBe(false);
      expect(await store.verifyMerchantSecret(merchant, testKeys.secretKey, TEST_NET)).toBe(true);
      expect(await store.verifyMerchantSecret(merchant, liveKeys.secretKey, LIVE_NET)).toBe(true);
    });

    it("creates a payout and lists it for the merchant", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      const payout = await store.createPayout({
        merchantAddress: merchant,
        networkIndex: TEST_NET,
        destination: randomAddress(),
        amountWei: 10n,
        token: "STRK",
        mode: "withdraw",
      });
      expect(payout.status).toBe("pending");
      await store.updatePayoutStatus(payout.id, "confirmed", "0x" + "d".repeat(10));
      const list = await store.listPayoutsFor(merchant, TEST_NET);
      expect(list).toHaveLength(1);
      expect(list[0].status).toBe("confirmed");
      expect(list[0].txHash).toBe("0x" + "d".repeat(10));
    });

    it("creates a fixed-amount payment link and reads it back by id", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      const link = await store.createPaymentLink({
        merchantAddress: merchant,
        networkIndex: TEST_NET,
        amountWei: 25000000n,
        token: "USDC",
        note: "Invoice #1",
      });
      expect(link.revoked).toBe(false);
      expect(link.ref).toBeTruthy();

      const fetched = await store.getPaymentLink(link.id);
      expect(fetched?.merchantAddress.toLowerCase()).toBe(merchant.toLowerCase());
      expect(fetched?.amountWei).toBe(25000000n);
      expect(fetched?.token).toBe("USDC");
      expect(fetched?.note).toBe("Invoice #1");
    });

    it("creates an open-amount payment link with no amountWei", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      const link = await store.createPaymentLink({ merchantAddress: merchant, networkIndex: TEST_NET, token: "STRK" });
      const fetched = await store.getPaymentLink(link.id);
      expect(fetched?.amountWei).toBeUndefined();
    });

    it("lists only the merchant's own payment links, for the given network", async () => {
      const store = makeStore();
      const merchantA = randomAddress();
      const merchantB = randomAddress();
      await store.createPaymentLink({ merchantAddress: merchantA, networkIndex: TEST_NET, token: "STRK" });
      await store.createPaymentLink({ merchantAddress: merchantA, networkIndex: TEST_NET, token: "STRK" });
      await store.createPaymentLink({ merchantAddress: merchantA, networkIndex: LIVE_NET, token: "STRK" });
      await store.createPaymentLink({ merchantAddress: merchantB, networkIndex: TEST_NET, token: "STRK" });
      expect(await store.listPaymentLinksFor(merchantA, TEST_NET)).toHaveLength(2);
      expect(await store.listPaymentLinksFor(merchantA, LIVE_NET)).toHaveLength(1);
      expect(await store.listPaymentLinksFor(merchantB, TEST_NET)).toHaveLength(1);
    });

    it("revokes a payment link only for its owning merchant", async () => {
      const store = makeStore();
      const merchant = randomAddress();
      const other = randomAddress();
      const link = await store.createPaymentLink({ merchantAddress: merchant, networkIndex: TEST_NET, token: "STRK" });

      expect(await store.revokePaymentLink(link.id, other)).toBe(false);
      expect((await store.getPaymentLink(link.id))?.revoked).toBe(false);

      expect(await store.revokePaymentLink(link.id, merchant)).toBe(true);
      expect((await store.getPaymentLink(link.id))?.revoked).toBe(true);
    });

    it("returns null for a payment link that doesn't exist", async () => {
      const store = makeStore();
      expect(await store.getPaymentLink(crypto.randomUUID())).toBeNull();
    });
  });
}
