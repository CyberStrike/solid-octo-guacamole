import { normalizePseud, type Database } from "@archive/db";
import type { ParsedWork } from "@archive/epub";
import type { Kysely } from "kysely";

/**
 * A DMCA notice's status once a moderator has removed its work. Only such a notice puts the
 * work's AO3 ID on the takedown list; a pending one blocks nothing. Whatever approves a notice
 * writes this value (orchestrator ruling for #34; X8 #68, MOD1 #44).
 */
export const TAKEDOWN_REMOVED = "removed";

const MAX_INT4 = 2_147_483_647;

/**
 * Whether the work may not be hosted (ARCHITECTURE, EPUB processor, step 4): a byline pseud
 * matches an active opt-out by its `pseud_norm`, any one author being enough, or its AO3 work
 * ID is on the takedown list, the works a moderator removed after a DMCA notice. Throws when
 * the lists can't be read, so a job never saves past an unread list.
 */
export async function onRejectList(
  db: Kysely<Database>,
  work: Pick<ParsedWork, "ao3WorkId" | "authors">,
): Promise<boolean> {
  return (await optedOut(db, work.authors)) || (await takenDown(db, work.ao3WorkId));
}

async function optedOut(db: Kysely<Database>, authors: ParsedWork["authors"]): Promise<boolean> {
  // A blank pseud matches no opt-out: the schema refuses a blank `pseud_norm`.
  const pseudNorms = [...new Set(authors.map((a) => normalizePseud(a.pseud)))].filter(
    (norm) => norm !== "",
  );
  if (pseudNorms.length === 0) return false;
  const row = await db
    .selectFrom("optouts")
    .select("id")
    .where("active", "=", true)
    .where("pseud_norm", "in", pseudNorms)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

async function takenDown(db: Kysely<Database>, ao3WorkId: string): Promise<boolean> {
  const id = Number(ao3WorkId);
  // `ao3_work_id` is an int4: any other ID has no work, so it is on no list.
  if (!Number.isInteger(id) || id < 1 || id > MAX_INT4) return false;
  const row = await db
    .selectFrom("takedowns")
    .innerJoin("works", "works.id", "takedowns.work_id")
    .select("takedowns.id")
    .where("works.ao3_work_id", "=", id)
    // A restored work is uploadable again.
    .where("works.status", "=", "removed")
    .where("takedowns.status", "=", TAKEDOWN_REMOVED)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
