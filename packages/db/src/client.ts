import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./schema";

export interface DbConfig {
  /** In a Worker, `env.HYPERDRIVE.connectionString`. */
  connectionString: string;
  /** Pool size. Defaults to pg's own default. */
  max?: number;
}

/** A Kysely instance over `pg`, typed with the archive's tables. */
export function createDb(config: DbConfig): Kysely<Database> {
  const pool = new pg.Pool({ connectionString: config.connectionString, max: config.max });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
