import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Keeps the database's CHECK constraints and the TypeScript unions honest
// about each other.
//
// ledger_entries.kind allowed three values while the code wrote four, and
// nothing noticed until a payout settled on-chain and then failed to write
// itself down. A type that the database will reject is not a type, and the
// only place that mismatch shows up is production.
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const TYPES = readFileSync(join(process.cwd(), "src", "server", "store", "types.ts"), "utf8");

/** The last constraint declared for a column wins — later migrations replace earlier ones. */
function allowedValues(column: string): string[] | null {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let found: string[] | null = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const re = new RegExp(`check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]+)\\)`, "gi");
    for (const m of sql.matchAll(re)) {
      found = [...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1]).sort();
    }
  }
  return found;
}

function unionValues(typeName: string): string[] {
  const re = new RegExp(`export type ${typeName} =([\\s\\S]*?);`, "m");
  const body = re.exec(TYPES)?.[1] ?? "";
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

describe("the database agrees with the types", () => {
  const pairs: [string, string][] = [
    ["kind", "LedgerKind"],
    ["direction", "LedgerDirection"],
    ["mode", "PayoutMode"],
    ["flow", "Flow"],
  ];

  for (const [column, typeName] of pairs) {
    it(`${typeName} matches the ${column} constraint exactly`, () => {
      const db = allowedValues(column);
      expect(db, `no CHECK constraint found for ${column}`).not.toBeNull();
      expect(unionValues(typeName)).toEqual(db);
    });
  }

  it("finds the widened kind constraint, not the original three", () => {
    // Guards the helper itself: if it read the first migration rather than the
    // last, every assertion above would pass against stale rules.
    expect(allowedValues("kind")).toContain("payout_fee");
  });
});
