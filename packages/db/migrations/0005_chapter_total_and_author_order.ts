// A work's planned chapter total (AO3's y in x/y; NULL when it's "?" or the
// byline gives none) on the work and on each version, beside the posted
// counts. And the byline order of a work's authors, as `work_tags.position`
// keeps the order of its tags. Works ingested before this keep a NULL total
// until they are uploaded again. Add-only: never edit this file once merged.
export default /* sql */ `
alter table "works" add column "chapters_total" integer;
alter table "works" add constraint "works_chapters_total_check"
  check ("chapters_total" is null or "chapters_total" >= 1);

alter table "work_versions" add column "chapter_total" integer;
alter table "work_versions" add constraint "work_versions_chapter_total_check"
  check ("chapter_total" is null or "chapter_total" >= 1);

alter table "work_authors" add column "position" integer;

-- Existing rows keep the order readers saw: by pseud, then user, a NULL user
-- first. "C" collation orders by code point, which differs from the code-unit
-- order the old query used only between astral and U+E000-U+FFFF characters.
-- Positions start at 0, as tags' do.
update "work_authors" set "position" = ordered."position"
from (
  select
    "work_id", "pseud", "ao3_user",
    (row_number() over (
      partition by "work_id"
      order by "pseud" collate "C", coalesce("ao3_user", '') collate "C", "ao3_user" nulls first
    ) - 1)::integer as "position"
  from "work_authors"
) as ordered
where "work_authors"."work_id" = ordered."work_id"
  and "work_authors"."pseud" = ordered."pseud"
  and "work_authors"."ao3_user" is not distinct from ordered."ao3_user";

alter table "work_authors" alter column "position" set not null;
-- Checked at commit, so a byline can be renumbered in one statement.
alter table "work_authors" add constraint "work_authors_work_id_position_key"
  unique ("work_id", "position") deferrable initially deferred;
`;
