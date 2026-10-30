import { sql, type Kysely } from "kysely";
import { migrations } from "../migrations/index";

// Any constant shared by every applier: concurrent `migrate` calls queue on it.
const MIGRATION_LOCK = 7_294_301;

/**
 * Applies every migration not yet applied, in order, each in its own
 * transaction, and records each in `schema_migrations`. Concurrent callers
 * wait for one another. Returns the names this call applied.
 */
export async function migrate(db: Kysely<any>): Promise<string[]> {
  const applied: string[] = [];
  for (const m of migrations) {
    const ran = await db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(${MIGRATION_LOCK})`.execute(trx);
      await sql`create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default current_timestamp
      )`.execute(trx);
      const done = await sql`select 1 from schema_migrations where name = ${m.name}`.execute(trx);
      if (done.rows.length > 0) return false;
      await sql.raw(m.sql).execute(trx);
      await sql`insert into schema_migrations (name) values (${m.name})`.execute(trx);
      return true;
    });
    if (ran) applied.push(m.name);
  }
  return applied;
}
