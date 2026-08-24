// Self-skips unless real Supabase credentials are present — no project
// exists yet as of this writing. Once SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// are set (locally or in CI secrets), this runs the same shared contract
// suite as memoryStore.test.ts against the live database.
import { describe, it } from "vitest";
import { runStoreContractTests } from "./contractTests";

const hasCredentials = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

if (hasCredentials) {
  const { SupabaseStore } = await import("./supabaseStore");
  runStoreContractTests("supabase", () => new SupabaseStore());
} else {
  describe.skip("Store contract (supabase)", () => {
    it("skipped: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", () => {});
  });
}
