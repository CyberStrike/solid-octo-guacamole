// Typed reads and writes over the catalogue and uploads. Each takes the
// caller's Kysely, so a Worker passes the one it made for the request.
import type { ExpressionBuilder, Kysely, Selectable } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import type {
  ChapterTable,
  Database,
  TagTable,
  TagType,
  WorkTable,
  WorkVersionTable,
} from "./schema";
import { normalizeTagName } from "./tags";

/** A work's own fields, as a page shows them. */
export type WorkSummary = Pick<
  Selectable<WorkTable>,
  | "id"
  | "ao3_work_id"
  | "title"
  | "summary_html"
  | "rating"
  | "language"
  | "words"
  | "chapters_count"
  | "chapters_total"
  | "complete"
  | "published_at"
  | "updated_at"
  | "status"
>;

export interface LiveWork {
  work: WorkSummary;
  /** In byline order. */
  authors: { pseud: string; ao3_user: string | null }[];
  /** In the author's order. */
  tags: Selectable<TagTable>[];
  version: Pick<
    Selectable<WorkVersionTable>,
    | "id"
    | "chapter_count"
    | "chapter_total"
    | "r2_prefix"
    | "created_at"
    | "review_reasons"
    | "checked_at"
  >;
  /** The current version's chapters, by number. */
  chapters: Pick<Selectable<ChapterTable>, "n" | "title" | "words" | "r2_key">[];
}

const SUMMARY = [
  "works.id",
  "works.ao3_work_id",
  "works.title",
  "works.summary_html",
  "works.rating",
  "works.language",
  "works.words",
  "works.chapters_count",
  "works.chapters_total",
  "works.complete",
  "works.published_at",
  "works.updated_at",
  "works.status",
] as const;

const MAX_INT4 = 2_147_483_647;

/**
 * A `live` work by its AO3 work ID, with its authors, tags and current
 * version's chapters. Null when there is none, or it's hidden or removed.
 */
export async function getLiveWork(
  db: Kysely<Database>,
  ao3WorkId: number,
): Promise<LiveWork | null> {
  // `ao3_work_id` is an int4: anything else is no work, not a database error.
  if (!Number.isInteger(ao3WorkId) || ao3WorkId < 1 || ao3WorkId > MAX_INT4) return null;
  // One statement, so the work, its version, byline, tags and chapters all
  // come from one snapshot even while a moderator switches versions (a cached
  // result through Hyperdrive is consistent, though not necessarily fresh).
  // json_agg doesn't promise its input order, so the lists are sorted here.
  const row = await db
    .selectFrom("works")
    .innerJoin("work_versions", "work_versions.id", "works.current_version_id")
    .select(SUMMARY)
    .select([
      "work_versions.id as version_id",
      "work_versions.chapter_count",
      "work_versions.chapter_total",
      "work_versions.r2_prefix",
      "work_versions.created_at",
      "work_versions.review_reasons",
      "work_versions.checked_at",
    ])
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom("work_authors")
          .select(["work_authors.pseud", "work_authors.ao3_user", "work_authors.position"])
          .whereRef("work_authors.work_id", "=", "works.id"),
      ).as("authors"),
      jsonArrayFrom(
        eb
          .selectFrom("work_tags")
          .innerJoin("tags", "tags.id", "work_tags.tag_id")
          .select(["tags.id", "tags.type", "tags.name", "tags.name_norm", "work_tags.position"])
          .whereRef("work_tags.work_id", "=", "works.id"),
      ).as("tags"),
      jsonArrayFrom(
        eb
          .selectFrom("chapters")
          .select(["chapters.n", "chapters.title", "chapters.words", "chapters.r2_key"])
          .whereRef("chapters.version_id", "=", "work_versions.id"),
      ).as("chapters"),
    ])
    .where("works.ao3_work_id", "=", ao3WorkId)
    .where("works.status", "=", "live")
    .executeTakeFirst();
  if (!row) return null;
  const {
    version_id,
    chapter_count,
    chapter_total,
    r2_prefix,
    created_at,
    review_reasons,
    checked_at,
    authors,
    tags,
    chapters,
    ...work
  } = row;
  return {
    work,
    authors: authors
      .sort((a, b) => a.position - b.position)
      .map(({ pseud, ao3_user }) => ({ pseud, ao3_user })),
    tags: tags
      .sort((a, b) => a.position - b.position)
      .map(({ id, type, name, name_norm }) => ({ id, type, name, name_norm })),
    version: {
      id: version_id,
      chapter_count,
      chapter_total,
      r2_prefix,
      created_at,
      review_reasons,
      checked_at,
    },
    chapters: chapters.sort((a, b) => a.n - b.n),
  };
}

/** A work as a listing's card shows it. */
export type ListedWork = Pick<LiveWork, "work" | "authors" | "tags">;

/**
 * The names a listing of `name` matches: `name` under the tag rule, and `name`
 * itself, since a tag link carries a stored `name_norm` and the rule isn't
 * idempotent for a few letters (NFKC can compose what lowercasing left). Empty
 * when it names no tag: it folds to nothing, or holds a NUL, which Postgres refuses.
 */
export function tagNameKeys(type: TagType, name: string): string[] {
  const nameNorm = normalizeTagName(type, name);
  if (nameNorm === "" || name.includes("\0")) return [];
  return nameNorm === name ? [name] : [nameNorm, name];
}

/** A page of a tag listing, and how many works the listing holds in all. */
export interface TagListing {
  works: ListedWork[];
  total: number;
}

/** Which page of a listing to read. Pages count from 1. */
export interface ListingOptions {
  page?: number;
  pageSize?: number;
}

/**
 * The `live` works carrying a tag of this type that matches `name` under the
 * tag rule (`tagNameKeys`), however each work spelled it, with their bylines
 * and tags: one page of them, and how many there are in all.
 */
export async function listLiveWorksByTag(
  db: Kysely<Database>,
  type: TagType,
  name: string,
  { page = 1, pageSize = 20 }: ListingOptions = {},
): Promise<TagListing> {
  const keys = tagNameKeys(type, name);
  if (keys.length === 0) return { works: [], total: 0 };
  const listed = (eb: ExpressionBuilder<Database, "works">) =>
    eb.and([
      eb("works.status", "=", "live"),
      eb.exists(
        eb
          .selectFrom("work_tags")
          .innerJoin("tags", "tags.id", "work_tags.tag_id")
          .select("work_tags.tag_id")
          .whereRef("work_tags.work_id", "=", "works.id")
          .where("tags.name_norm", "in", keys)
          .where("tags.type", "=", type),
      ),
    ]);
  const { count } = await db
    .selectFrom("works")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where(listed)
    .executeTakeFirstOrThrow();
  const total = Number(count);
  const offset = (page - 1) * pageSize;
  if (offset >= total) return { works: [], total };
  const rows = await db
    .selectFrom("works")
    .select(SUMMARY)
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom("work_authors")
          .select(["work_authors.pseud", "work_authors.ao3_user", "work_authors.position"])
          .whereRef("work_authors.work_id", "=", "works.id"),
      ).as("authors"),
      jsonArrayFrom(
        eb
          .selectFrom("work_tags")
          .innerJoin("tags", "tags.id", "work_tags.tag_id")
          .select(["tags.id", "tags.type", "tags.name", "tags.name_norm", "work_tags.position"])
          .whereRef("work_tags.work_id", "=", "works.id"),
      ).as("tags"),
    ])
    .where(listed)
    // AO3 work ID last, so a page never repeats or skips a work.
    .orderBy("works.ao3_work_id")
    .limit(pageSize)
    .offset(offset)
    .execute();
  // As in getLiveWork, json_agg's order isn't promised, so the lists are sorted here.
  const works = rows.map(({ authors, tags, ...work }) => ({
    work,
    authors: authors
      .sort((a, b) => a.position - b.position)
      .map(({ pseud, ao3_user }) => ({ pseud, ao3_user })),
    tags: tags
      .sort((a, b) => a.position - b.position)
      .map(({ id, type, name, name_norm }) => ({ id, type, name, name_norm })),
  }));
  return { works, total };
}

/**
 * Inserts a `pending` upload. The caller may choose its id, so the R2 key can
 * name it before the row exists.
 */
export async function insertUpload(
  db: Kysely<Database>,
  upload: { id?: string; userId: string; r2Key: string; bytes: number },
): Promise<{ id: string; status: "pending" }> {
  const row = await db
    .insertInto("uploads")
    .values({ id: upload.id, user_id: upload.userId, r2_key: upload.r2Key, bytes: upload.bytes })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { id: row.id, status: "pending" };
}
