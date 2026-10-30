// Test-only helper, exported as `@archive/db/testing`. Node only: it starts an
// in-process PGlite (WASM Postgres) behind a local Postgres wire socket, so
// tests reach it through the same `pg` driver `createDb` uses in production.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { Kysely } from "kysely";
import { createDb } from "./client";
import { migrate } from "./migrate";
import type { Database } from "./schema";

export interface TestDb {
  db: Kysely<Database>;
  /** A local connection string to the same database, for other clients. */
  connectionString: string;
  /** Closes the client, the socket and the database. Call it in `afterAll`. */
  close(): Promise<void>;
}

/** A fresh, empty database. With `migrate: false`, no migration is applied. */
export async function createTestDb(options: { migrate?: boolean } = {}): Promise<TestDb> {
  const lite = await PGlite.create();
  const server = new PGLiteSocketServer({ db: lite, port: 0 });
  await server.start();
  const connectionString = `postgresql://postgres@${server.getServerConn()}/postgres`;
  // PGlite is one session: one pooled connection keeps transactions whole.
  const db = createDb({ connectionString, max: 1 });
  if (options.migrate !== false) await migrate(db);
  return {
    db,
    connectionString,
    async close() {
      await db.destroy();
      await server.stop();
      await lite.close();
    },
  };
}
