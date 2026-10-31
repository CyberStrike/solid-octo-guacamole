// Test-only helper, exported as `@archive/db/seed`: seeds works the way ingest
// leaves them. It loads in Node and in workerd alike, so it imports neither
// `pg` nor PGlite (nor `./index`, which pulls in `pg`): the caller passes its
// own Kysely. It writes no R2 object itself; `putFragments` does, in workerd,
// with the test's bucket binding. Text is synthetic: no fic text in tests.
import type { Kysely, Transaction } from "kysely";
import type { Database, HiddenCause, TagType } from "./schema";
import { normalizeTagName } from "./tags";

export interface SeedChapter {
  title?: string;
  /** The fragment, as the sanitizer would leave it. Notes go inline. */
  html?: string;
  words?: number;
}

export interface SeedVersionOptions {
  /** A count, or each chapter. Default 1. */
  chapters?: number | SeedChapter[];
  reviewReasons?: string[];
}

export interface SeedWorkOptions extends SeedVersionOptions {
  /** Default: a random one, so test files sharing a database don't collide. */
  ao3WorkId?: number;
  title?: string;
  rating?: string | null;
  complete?: boolean;
  /** The uploader. Default: a new user. */
  userId?: string;
  authors?: { pseud: string; ao3_user: string | null }[];
  /** One author, stored as ingest stores an anonymous byline. Overrides `authors`. */
  anonymous?: boolean;
  /** In the author's order. */
  tags?: { type: TagType; name: string }[];
  /** Default `live`. A hidden work needs `hiddenCause`. */
  status?: "live" | "hidden" | "removed";
  hiddenCause?: HiddenCause;
}

/** One chapter fragment to put in R2. */
export interface Fragment {
  key: string;
  body: string;
}

export interface SeededVersion {
  uploadId: string;
  versionId: string;
  /** `works/<ao3_work_id>/<upload_id>/` */
  r2Prefix: string;
  /** Each chapter's `r2_key`, by number. */
  chapterKeys: string[];
  fragments: Fragment[];
}

export interface SeededWork extends SeededVersion {
  workId: string;
  ao3WorkId: number;
  userId: string;
}

/** Anything with R2's `put`, such as a test's `env.BUCKET`. */
export interface FragmentBucket {
  // oxlint-disable-next-line deslop/no-unknown-returns -- R2's put returns an object nobody here reads
  put(key: string, value: string): Promise<unknown>;
}

const DEFAULT_TAGS: { type: TagType; name: string }[] = [
  { type: "fandom", name: "Seed Fandom" },
  { type: "relationship", name: "Seed One/Seed Two" },
  { type: "character", name: "Seed One" },
  { type: "freeform", name: "Seed Freeform" },
];

/**
 * Inserts a work as ingest leaves it: the work, its authors and tags, and one
 * `live` upload with its version and chapters, in one transaction. Returns the
 * ids, keys and fragments, so tests needn't hard-code them.
 */
export async function seedWork(
  db: Kysely<Database>,
  options: SeedWorkOptions = {},
): Promise<SeededWork> {
  const ao3WorkId = options.ao3WorkId ?? randomAo3WorkId();
  const chapters = planChapters(options.chapters);
  const status = options.status ?? "live";
  return db.transaction().execute(async (trx) => {
    const userId = options.userId ?? (await addUser(trx));
    const work = await trx
      .insertInto("works")
      .values({
        ao3_work_id: ao3WorkId,
        title: options.title ?? `Seeded work ${ao3WorkId}`,
        summary_html: "<p>A seeded summary.</p>",
        rating: options.rating === undefined ? "Not Rated" : options.rating,
        language: "English",
        words: sum(chapters.map((c) => c.words)),
        chapters_count: chapters.length,
        complete: options.complete ?? true,
        status,
        hidden_cause: status === "hidden" ? (options.hiddenCause ?? "moderator") : null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const authors = options.anonymous
      ? [{ pseud: "Anonymous", ao3_user: null }]
      : (options.authors ?? [{ pseud: "Seed Author", ao3_user: "seed_author" }]);
    await trx
      .insertInto("work_authors")
      .values(authors.map((a) => ({ work_id: work.id, ...a })))
      .execute();
    await addTags(trx, work.id, options.tags ?? DEFAULT_TAGS);
    const seeded = { workId: work.id, ao3WorkId, userId };
    const version = await addVersion(trx, seeded, chapters, options.reviewReasons, true);
    return { ...seeded, ...version };
  });
}

/**
 * Adds a later version of a seeded work, from a new upload by the same user.
 * By default it replaces the current one; with `current: false` it is held,
 * and the work stays at the version it had.
 */
export async function seedVersion(
  db: Kysely<Database>,
  work: { workId: string; ao3WorkId: number; userId: string },
  options: SeedVersionOptions & { current?: boolean } = {},
): Promise<SeededVersion> {
  const chapters = planChapters(options.chapters);
  return db
    .transaction()
    .execute((trx) =>
      addVersion(trx, work, chapters, options.reviewReasons, options.current ?? true),
    );
}

/** Puts each fragment in the bucket. Call it before reading the seeded work. */
export async function putFragments(bucket: FragmentBucket, fragments: Fragment[]): Promise<void> {
  for (const f of fragments) await bucket.put(f.key, f.body);
}

type Planned = Required<SeedChapter>;

function planChapters(chapters: number | SeedChapter[] = 1): Planned[] {
  const list = Array.isArray(chapters) ? chapters : Array.from({ length: chapters }, () => ({}));
  return list.map((c: SeedChapter, i) => ({
    title: c.title ?? `Chapter ${i + 1}`,
    html: c.html ?? `<p>Seeded text of chapter ${i + 1}.</p>`,
    words: c.words ?? 1000,
  }));
}

async function addUser(trx: Transaction<Database>): Promise<string> {
  const id = `seed-${crypto.randomUUID()}`;
  await trx
    .insertInto("user")
    .values({ id, name: "Seed uploader", email: `${id}@example.test`, email_verified: true })
    .execute();
  return id;
}

async function addTags(
  trx: Transaction<Database>,
  workId: string,
  tags: { type: TagType; name: string }[],
): Promise<void> {
  for (const [position, tag] of tags.entries()) {
    // One row per type and name: a second seed of the same tag reuses it.
    const row = await trx
      .insertInto("tags")
      .values({ ...tag, name_norm: normalizeTagName(tag.type, tag.name) })
      .onConflict((oc) =>
        oc.columns(["type", "name"]).doUpdateSet((eb) => ({ name: eb.ref("excluded.name") })),
      )
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("work_tags")
      .values({ work_id: workId, tag_id: row.id, position })
      .execute();
  }
}

async function addVersion(
  trx: Transaction<Database>,
  work: { workId: string; ao3WorkId: number; userId: string },
  chapters: Planned[],
  reviewReasons: string[] = [],
  current: boolean,
): Promise<SeededVersion> {
  // Chosen here rather than by the database, because the R2 keys name it.
  const uploadId = crypto.randomUUID();
  const r2Prefix = `works/${work.ao3WorkId}/${uploadId}/`;
  await trx
    .insertInto("uploads")
    .values({
      id: uploadId,
      user_id: work.userId,
      r2_key: `uploads/${uploadId}.epub`,
      sha256: (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", ""),
      bytes: 1024,
      status: current ? "live" : "held_for_review",
      work_id: work.workId,
    })
    .execute();
  const version = await trx
    .insertInto("work_versions")
    .values({
      work_id: work.workId,
      upload_id: uploadId,
      chapter_count: chapters.length,
      r2_prefix: r2Prefix,
      review_reasons: reviewReasons,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const fragments = chapters.map((c, i) => ({ key: `${r2Prefix}${i + 1}.html`, body: c.html }));
  await trx
    .insertInto("chapters")
    .values(
      chapters.map((c, i) => ({
        work_id: work.workId,
        version_id: version.id,
        n: i + 1,
        title: c.title,
        words: c.words,
        r2_key: `${r2Prefix}${i + 1}.html`,
      })),
    )
    .execute();
  if (current) {
    await trx
      .updateTable("works")
      .set({
        current_version_id: version.id,
        chapters_count: chapters.length,
        words: sum(chapters.map((c) => c.words)),
      })
      .where("id", "=", work.workId)
      .execute();
  }
  return {
    uploadId,
    versionId: version.id,
    r2Prefix,
    chapterKeys: fragments.map((f) => f.key),
    fragments,
  };
}

function randomAo3WorkId(): number {
  return 1 + Math.floor(Math.random() * 2_000_000_000);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
