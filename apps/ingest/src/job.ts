import type { Database } from "@archive/db";
import { EpubError, LIMITS, type ParsedWork } from "@archive/epub";
import type { Kysely } from "kysely";
import { claimLease, endLease, type Lease } from "./lease";

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

/** Runs one upload's job, and says whether its message is done. */
export async function runJob(deps: JobDeps, uploadId: string): Promise<Verdict> {
  const lease = await claimLease(deps.db, uploadId);
  if (lease === null) return "ack";
  const object = await deps.bucket.get(lease.r2Key);
  if (object === null) return "ack";
  // By the object's size, before its body is read: an over-limit file never reaches memory.
  if (object.size > LIMITS.maxInputBytes) {
    await object.body.cancel();
    await endLease(deps.db, lease, {
      status: "too_large",
      failure: { stage: "read", error: "too_large" },
    });
    return "ack";
  }
  let work: ParsedWork;
  try {
    work = await deps.process(new Uint8Array(await object.arrayBuffer()));
  } catch (error) {
    if (!(error instanceof EpubError)) throw error;
    // A rejection is final for these bytes: recorded at once, never retried.
    await endLease(deps.db, lease, {
      status: error.code,
      failure: { stage: "process", error: error.code },
    });
    return "ack";
  }
  await deps.save(lease, work);
  return "ack";
}
