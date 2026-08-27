// Flow A verification: a private STRK20 transfer reveals neither sender,
// receiver, nor amount on the public chain by protocol default, so the only
// way to confirm one actually happened is for the operating wallet (the
// recipient) to check its own discovered notes for a match. See
// docs/ARCHITECTURE.md's "Resolved risk: headless STRK20 signing".
import type { NoteDiscoveryClient } from "@/utils/verifyTx";
import { myFrontendProviders } from "@/utils/constants";
import { getPrivacyClient } from "./privacyClient";

// networkIndex defaults to Sepolia (2) — the operating wallet isn't
// deployed on Mainnet yet (Sepolia-first build, see docs/ARCHITECTURE.md
// "Sequencing"). Threaded through explicitly by payments/route.ts once
// Mainnet cutover happens.
export function getNoteDiscoveryClient(networkIndex = 2): NoteDiscoveryClient {
  return {
    async hasReceivedDeposit({ claimedAmountWei, tokenAddress }) {
      const provider = myFrontendProviders[networkIndex];
      if (!provider) {
        throw new Error(`No RPC provider configured for network index ${networkIndex}.`);
      }
      const transfers = getPrivacyClient(provider);
      const tokenKey = BigInt(tokenAddress);
      const { notes } = await transfers.discoverNotes({ tokens: [tokenKey] });
      const forToken = notes.get(tokenKey) ?? [];
      return forToken.some((note) => note.amount === claimedAmountWei);
    },
  };
}
