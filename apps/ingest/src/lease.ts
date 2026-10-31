import type { Database } from "@archive/db";
import { sql, type Kysely } from "kysely";

/** How long a job holds its upload. Under the queue's retry_delay (wrangler.jsonc). */
export const LEASE_SECONDS = 60;

/** A claimed upload: what the job needs to read it. */
export interface Lease {
  id: string;
  r2Key: string;
}

/**
 * Claims the upload for one job, with one atomic `UPDATE` that matches only when it is
 * `pending` or its lease has expired (ARCHITECTURE, EPUB processor, step 1). The database's
 * clock decides, so two consumers agree on it. Null when another job holds the upload, or it
 * is past processing.
 */
export async function claimLease(db: Kysely<Database>, uploadId: string): Promise<Lease | null> {
  const row = await db
    .updateTable("uploads")
    .set({
      status: "processing",
      lease_until: sql<Date>`now() + make_interval(secs => ${LEASE_SECONDS})`,
    })
    .where("id", "=", uploadId)
    .where((eb) =>
      eb.or([
        eb("status", "=", "pending"),
        eb.and([eb("status", "=", "processing"), eb("lease_until", "<", sql<Date>`now()`)]),
      ]),
    )
    .returning(["id", "r2_key"])
    .executeTakeFirst();
  return row ? { id: row.id, r2Key: row.r2_key } : null;
}
