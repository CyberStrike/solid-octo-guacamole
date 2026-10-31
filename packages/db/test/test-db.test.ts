import net from "node:net";
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

  it("holds other clients until a transaction ends", async () => {
    const [holder, other] = await Promise.all([client(), client()]);
    try {
      await holder.query("begin");
      await holder.query("insert into client_turns (n) values ($1)", [-1]);
      let settled = false;
      const count = other
        .query<{ count: number }>("select count(*)::int as count from client_turns where n = -1")
        .finally(() => (settled = true));

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(settled).toBe(false);
      await holder.query("rollback");

      expect((await count).rows).toEqual([{ count: 0 }]);
    } finally {
      await Promise.all([holder.end(), other.end()]);
    }
  });

  it("refuses SSL, and still serves the next client", async () => {
    const ssl = new pg.Client({ connectionString: t.connectionString, ssl: true });
    await expect(ssl.connect()).rejects.toThrow("The server does not support SSL connections");

    const c = await client();
    try {
      expect((await c.query("select 1 as one")).rows).toEqual([{ one: 1 }]);
    } finally {
      await c.end();
    }
  });

  it("frees the database when a client drops inside a transaction", async () => {
    const dropped = await rawClient();
    await dropped.query("begin");
    await dropped.query("insert into client_turns (n) values (-2)");
    dropped.socket.destroy();

    const c = await client();
    try {
      const { rows } = await c.query(
        "select count(*)::int as count from client_turns where n = -2",
      );
      expect(rows).toEqual([{ count: 0 }]);
    } finally {
      await c.end();
    }
  });

  it("frees the database when a client drops part-way through a query", async () => {
    const dropped = await rawClient();
    // A Parse with no Sync after it: the query's cycle is open when the client goes.
    await dropped.parseOnly("select 1");
    // Long enough for the server to take the Parse before the client goes.
    await new Promise((resolve) => setTimeout(resolve, 100));
    dropped.socket.destroy();

    const c = await client();
    try {
      expect((await c.query("select $1::int as n", [7])).rows).toEqual([{ n: 7 }]);
    } finally {
      await c.end();
    }
  });
});

describe("createTestDb's close", () => {
  it("resolves with clients still connected, and stops listening", async () => {
    const other = await createTestDb({ migrate: false, maxConnections: 4 });
    const c = new pg.Client({ connectionString: other.connectionString });
    await c.connect();
    c.on("error", () => {});

    await other.close();

    const late = new pg.Client({ connectionString: other.connectionString });
    await expect(late.connect()).rejects.toThrow("ECONNREFUSED");
  });
});

/**
 * A client that speaks the simple query protocol over a bare socket, so a test can
 * drop it at any point. Each `query` resolves at the server's ReadyForQuery.
 */
async function rawClient() {
  const { hostname, port } = new URL(t.connectionString);
  const socket = net.connect(Number(port), hostname);
  let received = Buffer.alloc(0);
  let ready = () => {};
  socket.on("data", (chunk) => {
    received = Buffer.concat([received, chunk]);
    // Each server message: a type byte, then an int32 length that counts itself.
    while (received.length >= 5 && received.length >= 1 + received.readInt32BE(1)) {
      const type = received[0];
      received = received.subarray(1 + received.readInt32BE(1));
      if (type === 0x5a) ready();
    }
  });
  const send = (bytes: Buffer) =>
    new Promise<void>((resolve) => {
      ready = resolve;
      socket.write(bytes);
    });
  const message = (type: string, body: Buffer) => {
    const head = Buffer.alloc(5);
    head.write(type, 0);
    head.writeInt32BE(4 + body.length, 1);
    return Buffer.concat([head, body]);
  };
  const params = Buffer.from("user\0postgres\0database\0postgres\0\0");
  const startup = Buffer.alloc(8);
  startup.writeInt32BE(8 + params.length, 0);
  startup.writeInt32BE(196608, 4);
  await send(Buffer.concat([startup, params]));
  return {
    socket,
    query: (text: string) => send(message("Q", Buffer.from(`${text}\0`))),
    /** Sends a Parse of `text` on the unnamed statement, with no Sync to end it. */
    parseOnly: (text: string) =>
      new Promise<void>((resolve) => {
        // The server answers nothing before a Sync or Flush, so there is no reply to await.
        socket.write(message("P", Buffer.from(`\0${text}\0\0\0`)), () => resolve());
      }),
  };
}
