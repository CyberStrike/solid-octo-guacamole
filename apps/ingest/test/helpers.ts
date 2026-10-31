import { createDb, getLiveWork, insertUpload, type Database } from "@archive/db";
import { seedWork, type SeedWorkOptions } from "@archive/db/seed";
import { processEpub, type ParsedWork } from "@archive/epub";
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { sql, type Kysely } from "kysely";
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

/** An AO3 work ID no other test uses: one database serves every file, and works are keyed by it. */
export const newWorkId = () => 1 + Math.floor(Math.random() * 2_000_000_000);

/** The bucket step: the real bucket, with a `put` of `key` that fails as R2 down would. */
export const failingPut =
  (key: string): NonNullable<Steps["bucket"]> =>
  (real) => ({
    get: real.get.bind(real),
    put: async (k, value, options) => {
      if (k === key) throw new Error("injected R2 failure");
      return real.put(k, value, options);
    },
  });

/**
 * A parsed work, as the processor hands it to the save step, with `overrides`. Synthetic
 * text, and its own AO3 work ID.
 */
export function parsedWork(overrides: Partial<ParsedWork> = {}): ParsedWork {
  return {
    ao3WorkId: String(newWorkId()),
    title: "Synthetic Work",
    authors: [{ pseud: "someone", user: "someone" }],
    rating: "General Audiences",
    warnings: ["No Archive Warnings Apply"],
    categories: [],
    fandoms: ["Test Fandom"],
    relationships: [],
    characters: [],
    freeforms: [],
    language: "English",
    series: [],
    stats: {
      published: "2020-01-02",
      updated: null,
      completed: null,
      words: 3,
      chapters: { posted: 1, total: 1 },
    },
    summaryHtml: "<p>A synthetic summary.</p>",
    notesHtml: null,
    endNotesHtml: null,
    chapters: [{ n: 1, title: "One", html: "<p>marker-only-chapter text.</p>", words: 3 }],
    images: [],
    rawMeta: {},
    reviewReasons: [],
    ...overrides,
  };
}

/**
 * What the database holds of a job's save: `works` rows for the AO3 work ID, versions from
 * the upload, and `tags` rows with any of `tagNames`.
 */
export const savedRows = (ao3WorkId: number, uploadId: string, tagNames: string[] = []) =>
  withDb(async (db) => ({
    works: await db
      .selectFrom("works")
      .select(["id", "status", "current_version_id", "raw_meta"])
      .where("ao3_work_id", "=", ao3WorkId)
      .execute(),
    versions: await db
      .selectFrom("work_versions")
      .select("id")
      .where("upload_id", "=", uploadId)
      .execute(),
    tags:
      tagNames.length === 0
        ? []
        : await db.selectFrom("tags").select("name").where("name", "in", tagNames).execute(),
  }));

/** A `live` work already in the catalogue, as ingest would have left it. */
export const existingWork = (options: SeedWorkOptions) => withDb((db) => seedWork(db, options));

/** The work as the reader gets it (`getLiveWork`), or null when it isn't live. */
export const liveWork = (ao3WorkId: number) => withDb((db) => getLiveWork(db, ao3WorkId));

/**
 * The bucket step, watched: before each `put` it records the key and whether the `works` row
 * for `ao3WorkId` existed yet, reading through its own connection. Call `close()` after.
 */
export function watchedPuts(ao3WorkId: number) {
  const probe = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
  const puts: { key: string; workExisted: boolean }[] = [];
  const bucket: NonNullable<Steps["bucket"]> = (real) => ({
    get: real.get.bind(real),
    put: async (key, value, options) => {
      const row = await probe
        .selectFrom("works")
        .select("id")
        .where("ao3_work_id", "=", ao3WorkId)
        .executeTakeFirst();
      puts.push({ key, workExisted: row !== undefined });
      return real.put(key, value, options);
    },
  });
  return { bucket, puts, close: () => probe.destroy() };
}

/** The keys in the bucket under `prefix`, sorted. */
export async function bucketKeys(prefix: string): Promise<string[]> {
  const listed = await env.BUCKET.list({ prefix });
  return listed.objects.map((o) => o.key).sort();
}

/** The text of the object at `key`, or null. */
export async function bucketText(key: string): Promise<string | null> {
  const object = await env.BUCKET.get(key);
  return object === null ? null : object.text();
}
