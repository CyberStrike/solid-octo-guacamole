import type { Database } from "@archive/db";
import { EpubError, LIMITS, type ParsedWork } from "@archive/epub";
import type { Kysely } from "kysely";
import { MAX_RETRIES } from "./config";
import { claimLease, endLease, type Lease, type Outcome, type Stage } from "./lease";

/** What a job needs from outside: the request's Kysely, the bucket and the two steps. */
export interface JobDeps {
  db: Kysely<Database>;
  bucket: Pick<R2Bucket, "get">;
  /** The epub processor: bytes in, a parsed work out, or an `EpubError`. */
  process: (bytes: Uint8Array) => Promise<ParsedWork>;
  /** Saves the parsed work (R2 fragments, the Postgres transaction, `originals/`). */
  save: (upload: Lease, work: ParsedWork) => Promise<void>;
}

/** What the queue does with the message: `ack` it, or `retry` it. */
export type Verdict = "ack" | "retry";

/**
 * Runs one upload's job, on the message's `attempt` (from 1), and says whether its message is
 * done. A rejection is final and recorded at once. Any other failure, such as R2 or Postgres
 * being down, is retried with the lease released; on the last attempt it is recorded as
 * `parse_failed` and retried, so the queue dead-letters it.
 */
export async function runJob(deps: JobDeps, uploadId: string, attempt: number): Promise<Verdict> {
  const lease = await claimLease(deps.db, uploadId);
  // Another job holds it, or it is done: this delivery has nothing to do.
  if (lease === null) return "ack";
  let stage: Stage = "read";
  try {
    const outcome = await run(deps, lease, (next) => (stage = next));
    if (outcome !== null) await endLease(deps.db, lease, outcome);
    return "ack";
  } catch (error) {
    const final = attempt > MAX_RETRIES;
    await endLease(
      deps.db,
      lease,
      final
        ? {
            status: "parse_failed",
            failure: { stage, error: errorCode(error instanceof Error ? error.name : "") },
          }
        : { status: "pending" },
    );
    return "retry";
  }
}

/**
 * Reads, processes and saves the upload. Returns the outcome to record, or null when the work
 * was saved; throws on a failure worth retrying.
 */
async function run(
  deps: JobDeps,
  lease: Lease,
  enter: (stage: Stage) => void,
): Promise<Outcome | null> {
  const object = await deps.bucket.get(lease.r2Key);
  // Gone, as after the 7-day expiry of uploads/ (#176): no retry brings it back.
  if (object === null) {
    return { status: "parse_failed", failure: { stage: "read", error: "object_missing" } };
  }
  // By the object's size, before its body is read: an over-limit file never reaches memory.
  if (object.size > LIMITS.maxInputBytes) {
    await object.body.cancel();
    return { status: "too_large", failure: { stage: "read", error: "too_large" } };
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  enter("process");
  let work: ParsedWork;
  try {
    work = await deps.process(bytes);
  } catch (error) {
    if (!(error instanceof EpubError)) throw error;
    // The same bytes are rejected the same way every time, `parse_failed` included.
    return { status: error.code, failure: { stage: "process", error: error.code } };
  }
  enter("save");
  // Until I2 (#32), saving leaves the upload `processing`.
  await deps.save(lease, work);
  return null;
}

/**
 * A short code for `uploads.error`, which an uploader's page may show: the error's class
 * name, never its message, which can quote anything.
 */
function errorCode(name: string): string {
  return /^[A-Za-z]{1,40}$/.test(name) ? name : "Error";
}
