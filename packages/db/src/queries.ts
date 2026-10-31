// Typed reads and writes over the catalogue and uploads. Each takes the
// caller's Kysely, so a Worker passes the one it made for the request.
import type { Kysely, Selectable } from "kysely";
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
  | "complete"
  | "published_at"
  | "updated_at"
  | "status"
>;

export interface LiveWork {
  work: WorkSummary;
  authors: { pseud: string; ao3_user: string | null }[];
  /** In the author's order. */
  tags: Selectable<TagTable>[];
  version: Pick<
    Selectable<WorkVersionTable>,
    "id" | "chapter_count" | "r2_prefix" | "created_at" | "review_reasons" | "checked_at"
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
  // come from one snapshot even while a moderator switches versions.
  const row = await db
    .selectFrom("works")
    .innerJoin("work_versions", "work_versions.id", "works.current_version_id")
    .select(SUMMARY)
    .select([
      "work_versions.id as version_id",
      "work_versions.chapter_count",
      "work_versions.r2_prefix",
      "work_versions.created_at",
      "work_versions.review_reasons",
      "work_versions.checked_at",
    ])
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom("work_authors")
          .select(["work_authors.pseud", "work_authors.ao3_user"])
          .whereRef("work_authors.work_id", "=", "works.id")
          .orderBy("work_authors.pseud")
          .orderBy("work_authors.ao3_user"),
      ).as("authors"),
      jsonArrayFrom(
        eb
          .selectFrom("work_tags")
          .innerJoin("tags", "tags.id", "work_tags.tag_id")
          .select(["tags.id", "tags.type", "tags.name", "tags.name_norm"])
          .whereRef("work_tags.work_id", "=", "works.id")
          .orderBy("work_tags.position"),
      ).as("tags"),
      jsonArrayFrom(
        eb
          .selectFrom("chapters")
          .select(["chapters.n", "chapters.title", "chapters.words", "chapters.r2_key"])
          .whereRef("chapters.version_id", "=", "work_versions.id")
          .orderBy("chapters.n"),
      ).as("chapters"),
    ])
    .where("works.ao3_work_id", "=", ao3WorkId)
    .where("works.status", "=", "live")
    .executeTakeFirst();
  if (!row) return null;
  const {
    version_id,
    chapter_count,
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
    authors,
    tags,
    version: { id: version_id, chapter_count, r2_prefix, created_at, review_reasons, checked_at },
    chapters,
  };
}

/**
 * The `live` works carrying a tag of this type that matches `name` under the
 * tag rule, however each work spelled it.
 */
export async function listLiveWorksByTag(
  db: Kysely<Database>,
  type: TagType,
  name: string,
): Promise<WorkSummary[]> {
  const nameNorm = normalizeTagName(type, name);
  // A name of only punctuation folds to nothing, which names no tag.
  if (nameNorm === "") return [];
  return db
    .selectFrom("works")
    .select(SUMMARY)
    .where("works.status", "=", "live")
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("work_tags")
          .innerJoin("tags", "tags.id", "work_tags.tag_id")
          .select("work_tags.tag_id")
          .whereRef("work_tags.work_id", "=", "works.id")
          .where("tags.name_norm", "=", nameNorm)
          .where("tags.type", "=", type),
      ),
    )
    .orderBy("works.ao3_work_id")
    .execute();
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
