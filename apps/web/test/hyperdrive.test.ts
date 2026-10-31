import { createDb } from "@archive/db";
import { env } from "cloudflare:workers";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";

// The path every Postgres-backed web test relies on: pg in workerd, through the
// Worker's local Hyperdrive, to the database the global setup started.
describe("test database", () => {
  it("The Worker reaches the test database through Hyperdrive", async () => {
    const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
    try {
      const { rows } = await sql<{ one: number }>`select 1 as one`.execute(db);
      expect(rows).toEqual([{ one: 1 }]);
      // Migrated: Better Auth's tables are there.
      const tables = await sql<{ name: string }>`
        select table_name as name from information_schema.tables
        where table_name = 'verification'`.execute(db);
      expect(tables.rows).toEqual([{ name: "verification" }]);
    } finally {
      await db.destroy();
    }
  });
});
