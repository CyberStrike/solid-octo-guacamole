import type { Database, UploadStatus } from "@archive/db";
import { sql, type Kysely } from "kysely";

/** How long a job holds its upload. Under the queue's retry_delay (wrangler.jsonc). */
export const LEASE_SECONDS = 60;

/** A claimed upload: what the job needs to read it, and its lease. */
export interface Lease {
  id: string;
  r2Key: string;
  /** When the lease ends. Also the lease's token: each claim sets a new one. */
  until: Date;
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
      // To the millisecond, so the token survives the trip through a JavaScript Date.
      lease_until: sql<Date>`date_trunc('milliseconds', now() + make_interval(secs => ${LEASE_SECONDS}))`,
    })
    .where("id", "=", uploadId)
    .where((eb) =>
      eb.or([
        eb("status", "=", "pending"),
        eb.and([eb("status", "=", "processing"), eb("lease_until", "<", sql<Date>`now()`)]),
      ]),
    )
    .returning(["id", "r2_key", "lease_until"])
    .executeTakeFirst();
  // SAFETY: the update above sets lease_until on the row it returns.
  return row ? { id: row.id, r2Key: row.r2_key, until: row.lease_until as Date } : null;
}

/** How a job ends for its upload, as the row records it. */
export interface Outcome {
  status: Extract<UploadStatus, "pending" | "processing"> | RejectedStatus;
  /** The stage that failed, and a short fixed code for what happened. */
  failure?: { stage: string; error: string };
}

type RejectedStatus = Extract<
  UploadStatus,
  "not_epub" | "zip_bomb" | "too_large" | "not_ao3" | "parse_failed"
>;

/**
 * Records the outcome and ends the lease, only while this job still holds it: a job that
 * outlived its lease leaves the row to the job that took it over. False when it didn't.
 */
export async function endLease(
  db: Kysely<Database>,
  lease: Lease,
  outcome: Outcome,
): Promise<boolean> {
  const result = await db
    .updateTable("uploads")
    .set({
      status: outcome.status,
      lease_until: null,
      error_stage: outcome.failure?.stage ?? null,
      error: outcome.failure?.error ?? null,
    })
    .where("id", "=", lease.id)
    .where("status", "=", "processing")
    .where("lease_until", "=", lease.until)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
