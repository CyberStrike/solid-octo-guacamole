import { createDb, insertUpload, type Database } from "@archive/db";
import { seedWork, type SeedWorkOptions } from "@archive/db/seed";
import { processEpub } from "@archive/epub";
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { sql, type Kysely } from "kysely";
import { expect } from "vitest";
import { ao3Epub } from "../../../packages/epub/test/helpers";
import worker, { ingestWorker, type Steps } from "../src/worker";

// Shared by the workerd tests. One database serves every test file (test/global-setup.ts),
// so each upload gets its own user and ids.

type Handler = Pick<Required<typeof worker>, "queue">;

/** Runs `fn` with a Kysely on the test database, through the Worker's Hyperdrive. */
async function withDb<T>(fn: (db: Kysely<Database>) => Promise<T>): Promise<T> {
  const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
  try {
    return await fn(db);
  } finally {
    await db.destroy();
  }
}

/**
 * A `pending` upload by a new user, with `bytes` put at its R2 key. With `bytes` null,
 * nothing is put, as when the object has expired. Returns the upload's id.
 */
export async function pendingUpload(bytes: Uint8Array | null): Promise<string> {
  const id = crypto.randomUUID();
  const userId = `ingest-${id}`;
  const r2Key = `uploads/${id}.epub`;
  await withDb(async (db) => {
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
  });
  if (bytes !== null) await env.BUCKET.put(r2Key, bytes);
  return id;
}

/** The upload's row, as the job leaves it. */
export const uploadRow = (id: string) =>
  withDb((db) =>
    db
      .selectFrom("uploads")
      .select(["status", "lease_until", "error_stage", "error", "work_id"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow(),
  );

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
  const row = await withDb((db) =>
    db
      .updateTable("uploads")
      .set({ status: "processing", lease_until: sql<Date>`now() + ${interval}::interval` })
      .where("id", "=", id)
      .returning("lease_until")
      .executeTakeFirstOrThrow(),
  );
  // SAFETY: the update above has just set it.
  return row.lease_until as Date;
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

/**
 * An opt-out with `pseudNorm` as given, and the `opt_out` request it comes from. Returns the
 * opt-out's id. The text is synthetic.
 */
export function addOptOut(pseudNorm: string): Promise<string> {
  return withDb(async (db) => {
    const request = await db
      .insertInto("requests")
      .values({
        kind: "opt_out",
        pseud_norm: pseudNorm,
        contact_email: "requester@example.test",
        statement: "A synthetic statement.",
        ip_hash: "test-ip-hash",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const optOut = await db
      .insertInto("optouts")
      .values({ pseud_norm: pseudNorm, request_id: request.id, active: true })
      .returning("id")
      .executeTakeFirstOrThrow();
    return optOut.id;
  });
}

/** Reverses the opt-out, as a moderator does for a mistaken one. */
export const deactivateOptOut = (id: string) =>
  withDb((db) => db.updateTable("optouts").set({ active: false }).where("id", "=", id).execute());

/** A DMCA notice on the work, in the notice's `status`: `TAKEDOWN_REMOVED` once acted on. */
export const addTakedown = (workId: string, status: string) =>
  withDb((db) =>
    db
      .insertInto("takedowns")
      .values({ work_id: workId, requester: "A rights holder", basis: "A stated basis", status })
      .execute(),
  );

/** A work seeded as ingest leaves it (`@archive/db/seed`). */
export const seededWork = (options: SeedWorkOptions) => withDb((db) => seedWork(db, options));

/** Whether any work has the AO3 work ID. */
export const workExists = (ao3WorkId: number) =>
  withDb(async (db) => {
    const row = await db
      .selectFrom("works")
      .select("id")
      .where("ao3_work_id", "=", ao3WorkId)
      .executeTakeFirst();
    return row !== undefined;
  });

/** A lowercase token, to keep a test's pseud its own on the shared database. */
export const token = () => crypto.randomUUID().slice(0, 8);

/**
 * A random int4 AO3 work ID, well above `ao3Epub`'s default. Random like `seedWork`'s, whose
 * range it shares: a clash with a seeded work is possible but negligibly unlikely.
 */
export const freshAo3WorkId = () => 100_000_000 + Math.floor(Math.random() * 2_000_000_000);

/**
 * Uploads a synthetic epub of AO3 work `workId` and ingests it, with the byline `pseuds` over
 * the epub's own (the synthetic epubs all carry one byline), or the epub's own when none are
 * given. Returns the upload's id and row, the queue's result, and `saved`: the id of each
 * upload the job saved.
 */
export async function ingestEpub(workId: number, ...pseuds: string[]) {
  const id = await pendingUpload(ao3Epub({ workId }));
  const saved: string[] = [];
  const process: Steps["process"] = async (bytes) => {
    const work = await processEpub(bytes);
    return pseuds.length === 0
      ? work
      : { ...work, authors: pseuds.map((pseud) => ({ pseud, user: null })) };
  };
  const { handler } = watchedWorker({
    process,
    save: async (upload) => void saved.push(upload.id),
  });
  const result = await deliver([{ upload_id: id }], { handler });
  return { id, row: await uploadRow(id), saved, result };
}

type Ingested = Awaited<ReturnType<typeof ingestEpub>>;

/** Expects the upload rejected as `opted_out`: final and acked, with no work, never saved. */
export function expectOptedOut({ row, saved, result }: Ingested) {
  expect(row.status).toBe("opted_out");
  expect(row.error_stage).toBe("process");
  expect(row.error).toBe("opted_out");
  expect(row.work_id).toBeNull();
  expect(row.lease_until).toBeNull();
  // Before anything is written: the save step never ran.
  expect(saved).toEqual([]);
  expect(result.explicitAcks).toEqual(["msg-0"]);
  expect(result.retryMessages).toEqual([]);
}

/** Expects the upload not rejected as `opted_out`: the job went on to save it. */
export function expectNotOptedOut({ id, row, saved }: Ingested) {
  expect(row.status).not.toBe("opted_out");
  expect(saved).toEqual([id]);
}
