import { createDb, insertUpload } from "@archive/db";
import { processEpub } from "@archive/epub";
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { sql } from "kysely";
import worker, { ingestWorker, type Steps } from "../src/worker";

// Shared by the workerd tests. One database serves every test file (test/global-setup.ts),
// so each upload gets its own user and ids.

type Handler = Pick<Required<typeof worker>, "queue">;

/** A Kysely on the test database, through the Worker's Hyperdrive. Destroy it after. */
export const testDb = () => createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });

/**
 * A `pending` upload by a new user, with `bytes` put at its R2 key. With `bytes` null,
 * nothing is put, as when the object has expired. Returns the upload's id.
 */
export async function pendingUpload(bytes: Uint8Array | null): Promise<string> {
  const id = crypto.randomUUID();
  const userId = `ingest-${id}`;
  const r2Key = `uploads/${id}.epub`;
  const db = testDb();
  try {
    await db
      .insertInto("user")
      .values({
        id: userId,
        name: "Ingest uploader",
        email: `${userId}@example.test`,
        email_verified: true,
      })
      .execute();
    await insertUpload(db, { id, userId, r2Key, bytes: bytes?.byteLength ?? 0 });
  } finally {
    await db.destroy();
  }
  if (bytes !== null) await env.BUCKET.put(r2Key, bytes);
  return id;
}

/** The upload's row, as the job leaves it. */
export async function uploadRow(id: string) {
  const db = testDb();
  try {
    return await db
      .selectFrom("uploads")
      .select(["status", "lease_until", "error_stage", "error", "work_id"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
  } finally {
    await db.destroy();
  }
}

/** Runs the queue handler on one batch of message bodies, and returns the queue's result. */
export async function deliver(
  bodies: unknown[],
  { attempts = 1, handler = worker }: { attempts?: number; handler?: Handler } = {},
) {
  const batch = createMessageBatch(
    "ingest",
    bodies.map((body, i) => ({ id: `msg-${i}`, timestamp: new Date(1000), attempts, body })),
  );
  const ctx = createExecutionContext();
  await handler.queue(batch, env, ctx);
  return getQueueResult(batch, ctx);
}

/**
 * Puts the upload in `processing` with its lease ending `interval` from now (a Postgres
 * interval, negative for an expired lease). Returns the new `lease_until`.
 */
export async function setLease(id: string, interval: string): Promise<Date> {
  const db = testDb();
  try {
    const row = await db
      .updateTable("uploads")
      .set({ status: "processing", lease_until: sql<Date>`now() + ${interval}::interval` })
      .where("id", "=", id)
      .returning("lease_until")
      .executeTakeFirstOrThrow();
    // SAFETY: the update above has just set it.
    return row.lease_until as Date;
  } finally {
    await db.destroy();
  }
}

/**
 * A processor step that holds each job until `release()`: `entered` resolves once the
 * first job is inside it, and `running`/`most` count the jobs inside it now and at most.
 */
export function gated() {
  let enter = () => {};
  let release = () => {};
  const entered = new Promise<void>((resolve) => (enter = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const counts = { running: 0, most: 0 };
  const process: Steps["process"] = async (bytes) => {
    counts.running++;
    counts.most = Math.max(counts.most, counts.running);
    enter();
    await released;
    try {
      return await processEpub(bytes);
    } finally {
      counts.running--;
    }
  };
  return { process, entered, release, counts };
}

/**
 * The queue handler with `steps` over the real ones, watched: `parsed` gets each epub the
 * job hands the processor, in order.
 */
export function watchedWorker(steps: Partial<Steps> = {}) {
  const parsed: Uint8Array[] = [];
  const process = steps.process ?? processEpub;
  const handler = ingestWorker({
    ...steps,
    process: async (bytes) => {
      parsed.push(bytes);
      return process(bytes);
    },
  });
  return { handler, parsed };
}
