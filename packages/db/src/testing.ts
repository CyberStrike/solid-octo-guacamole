// Test-only helper, exported as `@archive/db/testing`. Node only: it starts an
// in-process PGlite (WASM Postgres) behind a local Postgres wire socket, so
// tests reach it through the same `pg` driver `createDb` uses in production.
// PGlite is a dev dependency here: a workspace importing this lists it too.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { Kysely } from "kysely";
import { createDb } from "./client";
import { migrate } from "./migrate";
import type { Database } from "./schema";

export interface TestDb {
  db: Kysely<Database>;
  /** Where another client reaches the same database, such as a Worker's local Hyperdrive. */
  connectionString: string;
  /** Closes the client, the socket and the database. Call it in `afterAll`. */
  close(): Promise<void>;
}

export interface TestDbOptions {
  /** Left out or true, every migration is applied. */
  migrate?: boolean;
  /**
   * How many clients the socket takes at once, `db` included. The default of 1
   * is `db` alone; give more when other clients use `connectionString` too.
   */
  maxConnections?: number;
}

/** A fresh, empty database. With `migrate: false`, no migration is applied. */
export async function createTestDb(options: TestDbOptions = {}): Promise<TestDb> {
  const lite = await PGlite.create();
  const server = new PGLiteSocketServer({
    db: lite,
    port: 0,
    maxConnections: options.maxConnections,
  });
  let db: Kysely<Database> | undefined;
  const close = async () => {
    await db?.destroy();
    await server.stop();
    await lite.close();
  };
  try {
    await server.start();
    // PGlite ignores the password; Miniflare's Hyperdrive refuses a URL without one.
    const connectionString = `postgresql://postgres:postgres@${server.getServerConn()}/postgres`;
    // PGlite is one session: the socket queues every client's queries on it.
    db = createDb({ connectionString, max: 1 });
    if (options.migrate !== false) await migrate(db);
    return { db, connectionString, close };
  } catch (err) {
    await close();
    throw err;
  }
}
