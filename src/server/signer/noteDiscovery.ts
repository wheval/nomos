// Placeholder note-discovery client. Phase 3 wires the real
// @starkware-libs/starknet-privacy-sdk discoverNotes() call, once the
// operating wallet itself is deployed (see docs/ARCHITECTURE.md's resolved
// headless-signing risk, and scripts/spikes/headless-strk20.ts for the
// verified SDK shape). Until then, Flow A deposits can be recorded but
// don't verify — this throws clearly rather than silently approving them.
import type { NoteDiscoveryClient } from "@/utils/verifyTx";

export function getNoteDiscoveryClient(): NoteDiscoveryClient {
  return {
    async hasReceivedDeposit() {
      throw new Error(
        "Flow A verification needs the operating wallet's note-discovery client (Phase 3, not yet built). " +
          "See docs/ARCHITECTURE.md."
      );
    },
  };
}
