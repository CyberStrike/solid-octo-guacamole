import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./schema";

export interface DbConfig {
  /** In a Worker, `env.HYPERDRIVE.connectionString`. */
  connectionString: string;
  /** Pool size. Left out (or 0), pg's default of 10 applies. */
  max?: number;
}

/**
 * A Kysely instance over `pg`, typed with the archive's tables. It owns its
 * pool: in a Worker, create one per request and end it with
 * `ctx.waitUntil(db.destroy())`, since connections can't outlive the request.
 */
export function createDb(config: DbConfig): Kysely<Database> {
  const pool = new pg.Pool({ connectionString: config.connectionString, max: config.max });
  // pg reports an idle client's lost connection as an error on the pool, and an
  // EventEmitter with no listener throws it. The pool has already dropped that
  // client, and a query on a lost connection fails on its own, so this one only
  // keeps it from being thrown. In workerd, ending the pool does it every time:
  // the socket's pending read rejects once the socket is closed.
  pool.on("error", () => undefined);
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
