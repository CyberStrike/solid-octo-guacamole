import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../src/testing";

// The test database other workspaces share: one PGlite session that several
// clients reach through `connectionString` at once, as a Worker's per-request
// pools do. These tests use real `pg` clients on that string.

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb({ maxConnections: 16 });
  await sql`create table client_turns (n int not null)`.execute(t.db);
});
afterAll(async () => {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- unset if beforeAll failed
  await t?.close();
});

/** A connected `pg` client on the test database. */
async function client(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: t.connectionString });
  await c.connect();
  return c;
}

const ROUNDS = 40;

describe("createTestDb", () => {
  it("keeps concurrent clients' queries apart", async () => {
    const clients = await Promise.all(Array.from({ length: 8 }, client));
    try {
      // Parameterized queries: each is Parse, Bind, Describe, Execute and Sync on the
      // unnamed statement, which every client shares on PGlite's one session.
      const sums = clients.slice(0, 5).map(async (c, k) => {
        for (let i = 0; i < ROUNDS; i++) {
          const { rows } = await c.query("select $1::int + $2::int as sum", [k, i]);
          expect(rows).toEqual([{ sum: k + i }]);
        }
      });
      // A transaction sees its own insert, and nothing of another client's.
      const transactions = clients.slice(5, 7).map(async (c, k) => {
        for (let i = 0; i < ROUNDS; i++) {
          const n = 1000 * (k + 1) + i;
          await c.query("begin");
          await c.query("insert into client_turns (n) values ($1)", [n]);
          const { rows } = await c.query(
            "select count(*)::int as count from client_turns where n = $1",
            [n],
          );
          expect(rows).toEqual([{ count: 1 }]);
          await c.query(i % 2 === 0 ? "commit" : "rollback");
        }
      });
      // A failed transaction stays its client's until its rollback.
      const failed = (async (c: pg.Client) => {
        for (let i = 0; i < ROUNDS; i++) {
          await c.query("begin");
          await expect(c.query("select 1 / $1::int", [0])).rejects.toThrow("division by zero");
          await c.query("rollback");
        }
      })(clients[7]!);
      const own = (async () => {
        for (let i = 0; i < ROUNDS; i++) {
          const { rows } = await sql<{ n: number }>`select ${i}::int as n`.execute(t.db);
          expect(rows).toEqual([{ n: i }]);
        }
      })();

      await Promise.all([...sums, ...transactions, failed, own]);

      // Committed: the even rounds of each transaction loop, rolled back the odd.
      const { rows } = await sql<{ count: number }>`
        select count(*)::int as count from client_turns`.execute(t.db);
      expect(rows).toEqual([{ count: ROUNDS }]);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
