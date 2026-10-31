import net from "node:net";
import { setTimeout } from "node:timers/promises";
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
      // Each transaction sees its own insert, and its commit or rollback takes only its
      // own. The first client commits every 2nd round and the second every 4th, so a
      // commit or rollback that took the other's insert too would change the counts.
      const transactions = [2, 4].map(async (every, k) => {
        const c = clients[5 + k]!;
        for (let i = 0; i < ROUNDS; i++) {
          const n = 1000 * (k + 1) + i;
          await c.query("begin");
          await c.query("insert into client_turns (n) values ($1)", [n]);
          const { rows } = await c.query(
            "select count(*)::int as count from client_turns where n = $1",
            [n],
          );
          expect(rows).toEqual([{ count: 1 }]);
          await c.query(i % every === 0 ? "commit" : "rollback");
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

      // Committed: 20 of the first client's 40 rounds, and 10 of the second's.
      const { rows } = await sql<{ first: number; second: number }>`
        select count(*) filter (where n between 1000 and 1999)::int as first,
               count(*) filter (where n between 2000 and 2999)::int as second
        from client_turns`.execute(t.db);
      expect(rows).toEqual([{ first: 20, second: 10 }]);
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

      await setTimeout(50);
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

  it("holds other clients until a query's cycle ends, and frees them if its client drops", async () => {
    const c = await client();
    const dropped = await rawClient();
    try {
      // A Parse with no Sync after it: the query's cycle is open.
      await dropped.parseOnly("select 1");
      let settled = false;
      const answer = c.query("select $1::int as n", [7]).finally(() => (settled = true));

      await setTimeout(50);
      expect(settled).toBe(false);
      dropped.socket.destroy();

      expect((await answer).rows).toEqual([{ n: 7 }]);
    } finally {
      await c.end();
    }
  });

  it("frees the database when a client drops after a failed Parse, before its Sync", async () => {
    const dropped = await rawClient();
    // The server now skips this client's messages until a Sync that never comes.
    await expect(dropped.parseOnly("selec 1")).rejects.toThrow("syntax error");
    dropped.socket.destroy();

    const c = await client();
    try {
      expect((await c.query("select $1::int as n", [8])).rows).toEqual([{ n: 8 }]);
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
    // Left open, so close() has a transaction to end.
    await c.query("begin");

    await other.close();

    const late = new pg.Client({ connectionString: other.connectionString });
    await expect(late.connect()).rejects.toThrow("ECONNREFUSED");
  });
});

// Server message types the raw client waits for.
const READY_FOR_QUERY = 0x5a;
const PARSE_COMPLETE = 0x31;
const ERROR_RESPONSE = 0x45;

/** An ErrorResponse's message: its fields are a code byte and a C string each, then a 0. */
function errorMessage(body: Buffer): string {
  for (let at = 0; at < body.length && body[at] !== 0;) {
    const end = body.indexOf(0, at + 1);
    if (body[at] === 0x4d) return body.toString("utf8", at + 1, end);
    at = end + 1;
  }
  return "error";
}

/** The server message a raw client's send waits for, and what to do on it or an error. */
interface Reply {
  type: number;
  arrived(): void;
  failed(err: Error): void;
}

/**
 * A client that speaks the wire protocol over a bare socket, so a test can drop it at
 * any point. Each `query` resolves at the server's ReadyForQuery, and rejects with the
 * server's message on an ErrorResponse.
 */
async function rawClient() {
  const { hostname, port } = new URL(t.connectionString);
  const socket = net.connect(Number(port), hostname);
  let received = Buffer.alloc(0);
  let awaited: Reply = { type: READY_FOR_QUERY, arrived: () => {}, failed: () => {} };
  socket.on("data", (chunk) => {
    received = Buffer.concat([received, chunk]);
    // Each server message: a type byte, then an int32 length that counts itself.
    while (received.length >= 5) {
      const end = 1 + received.readInt32BE(1);
      if (received.length < end) break;
      const type = received[0];
      const body = received.subarray(5, end);
      received = received.subarray(end);
      if (type === ERROR_RESPONSE) awaited.failed(new Error(errorMessage(body)));
      else if (type === awaited.type) awaited.arrived();
    }
  });
  /** Sends `bytes`, and resolves when a server message of type `until` arrives. */
  const send = (bytes: Buffer, until = READY_FOR_QUERY) =>
    new Promise<void>((resolve, reject) => {
      awaited = { type: until, arrived: resolve, failed: reject };
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
    /**
     * Sends a Parse of `text` on the unnamed statement and a Flush, with no Sync to end
     * the cycle, and resolves once the server has parsed it.
     */
    parseOnly: (text: string) =>
      send(
        Buffer.concat([
          message("P", Buffer.from(`\0${text}\0\0\0`)),
          message("H", Buffer.alloc(0)),
        ]),
        PARSE_COMPLETE,
      ),
  };
}
