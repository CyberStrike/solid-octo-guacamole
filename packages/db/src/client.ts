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
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
