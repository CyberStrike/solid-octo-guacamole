import { sql, type Kysely } from "kysely";
import { migrations } from "../migrations/index";

/**
 * Applies every migration not yet applied, in order, in one transaction, and
 * records each in `schema_migrations`. Returns the names it applied.
 */
export async function migrate(db: Kysely<any>): Promise<string[]> {
  return db.transaction().execute(async (trx) => {
    await sql`create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default current_timestamp
    )`.execute(trx);
    const rows = await sql<{ name: string }>`select name from schema_migrations`.execute(trx);
    const done = new Set(rows.rows.map((r) => r.name));
    const applied: string[] = [];
    for (const m of migrations) {
      if (done.has(m.name)) continue;
      await sql.raw(m.sql).execute(trx);
      await sql`insert into schema_migrations (name) values (${m.name})`.execute(trx);
      applied.push(m.name);
    }
    return applied;
  });
}
