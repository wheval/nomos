// Flow A verification: a private STRK20 transfer reveals neither sender,
// receiver, nor amount on the public chain by protocol default, so the only
// way to confirm one actually happened is for the operating wallet (the
// recipient) to check its own discovered notes for a match. See
// docs/ARCHITECTURE.md's "Resolved risk: headless STRK20 signing".
import type { NoteDiscoveryClient } from "@/utils/verifyTx";
import { myFrontendProviders } from "@/utils/constants";
import { getDiscoveryClient } from "./privacyClient";

// networkIndex defaults to Sepolia (2) and is threaded through to the
// discovery client, which resolves its own pool address per network — so a
// mainnet caller discovers against the mainnet pool, not whichever one
// happened to be built first.
export function getNoteDiscoveryClient(networkIndex = 2): NoteDiscoveryClient {
  return {
    // Returns the notes themselves rather than a yes/no. Deciding *which*
    // note settles a deposit — and marking it spent — is verification's job;
    // an "is there one?" answer is what let the same note be credited twice.
    async listNotes({ tokenAddress }) {
      const provider = myFrontendProviders[networkIndex];
      if (!provider) {
        throw new Error(`No RPC provider configured for network index ${networkIndex}.`);
      }
      const transfers = getDiscoveryClient(provider, networkIndex);
      const tokenKey = BigInt(tokenAddress);
      const { notes } = await transfers.discoverNotes({ tokens: [tokenKey] });
      const forToken = notes.get(tokenKey) ?? [];
      return forToken.map((note) => ({
        id: BigInt(note.id).toString(),
        amount: note.amount,
        createdBlock: typeof note.created === "number" ? note.created : undefined,
      }));
    },
  };
}
