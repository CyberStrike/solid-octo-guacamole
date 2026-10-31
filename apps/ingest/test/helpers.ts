import { createDb, insertUpload } from "@archive/db";
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import worker from "../src/worker";

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
