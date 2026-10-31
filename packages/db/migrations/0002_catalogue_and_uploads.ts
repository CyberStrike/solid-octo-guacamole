// The catalogue (works, their authors, versions, chapters and tags) and the
// uploads that produce it, from ARCHITECTURE's Data model. Chapter text is in
// R2, never here. Ids are random text, so none of them counts anything.
// Add-only: never edit this file once merged. A new status is a new migration
// that drops and re-adds the named check.
export default /* sql */ `
create table "works" (
  "id" text not null primary key default gen_random_uuid()::text,
  "ao3_work_id" integer not null unique,
  "title" text not null,
  "summary_html" text,
  "rating" text,
  "language" text,
  "words" integer,
  "chapters_count" integer not null,
  "complete" boolean not null,
  "published_at" timestamptz,
  "updated_at" timestamptz,
  "status" text not null default 'processing',
  "hidden_cause" text,
  "current_version_id" text,
  "raw_meta" jsonb not null default '{}',
  "search" tsvector,
  constraint "works_status_check"
    check ("status" in ('processing', 'live', 'hidden', 'removed')),
  constraint "works_hidden_cause_check"
    check ("hidden_cause" in ('removal_request', 'reports', 'moderator')),
  constraint "works_hidden_cause_while_hidden"
    check (("status" = 'hidden') = ("hidden_cause" is not null)),
  constraint "works_current_version_unless_processing"
    check ("status" = 'processing' or "current_version_id" is not null)
);

create table "uploads" (
  "id" text not null primary key default gen_random_uuid()::text,
  "user_id" text not null references "user" ("id"),
  "r2_key" text not null,
  "sha256" text,
  "bytes" integer not null check ("bytes" >= 0),
  "status" text not null default 'pending',
  "lease_until" timestamptz,
  "error_stage" text,
  "error" text,
  "work_id" text references "works" ("id") on delete set null,
  "created_at" timestamptz not null default current_timestamp,
  constraint "uploads_status_check"
    check ("status" in (
      'pending', 'processing', 'live', 'held_for_review', 'duplicate',
      'not_epub', 'zip_bomb', 'too_large', 'not_ao3', 'opted_out', 'parse_failed'
    ))
);

create table "work_versions" (
  "id" text not null primary key default gen_random_uuid()::text,
  "work_id" text not null references "works" ("id") on delete cascade,
  "upload_id" text not null unique references "uploads" ("id"),
  "chapter_count" integer not null,
  "r2_prefix" text not null,
  "created_at" timestamptz not null default current_timestamp,
  "review_reasons" text[] not null default '{}',
  "checked_at" timestamptz,
  unique ("id", "work_id")
);

-- Circular with work_versions.work_id, so added once both tables exist. The
-- pair makes the current version one of the work's own.
alter table "works" add constraint "works_current_version_fkey"
  foreign key ("current_version_id", "id") references "work_versions" ("id", "work_id");

create table "chapters" (
  "work_id" text not null,
  "version_id" text not null,
  "n" integer not null,
  "title" text not null,
  "words" integer not null,
  "r2_key" text not null,
  primary key ("version_id", "n"),
  foreign key ("version_id", "work_id")
    references "work_versions" ("id", "work_id") on delete cascade
);

create table "tags" (
  "id" text not null primary key default gen_random_uuid()::text,
  "type" text not null,
  "name" text not null,
  "name_norm" text not null,
  unique ("type", "name"),
  constraint "tags_type_check"
    check ("type" in (
      'fandom', 'relationship', 'character', 'freeform', 'warning', 'category', 'rating'
    ))
);

create table "work_tags" (
  "work_id" text not null references "works" ("id") on delete cascade,
  "tag_id" text not null references "tags" ("id"),
  "position" integer not null,
  primary key ("work_id", "tag_id"),
  -- Checked at commit, so a work's tags can be renumbered in one statement.
  unique ("work_id", "position") deferrable initially deferred
);

create table "work_authors" (
  "work_id" text not null references "works" ("id") on delete cascade,
  "pseud" text not null,
  "ao3_user" text,
  -- A pseud name is unique only within its user, so two co-authors can share one.
  unique nulls not distinct ("work_id", "pseud", "ao3_user")
);

create index "uploads_user_id_idx" on "uploads" ("user_id");
create index "uploads_sha256_idx" on "uploads" ("sha256");
create index "uploads_work_id_idx" on "uploads" ("work_id");
create index "works_current_version_id_idx" on "works" ("current_version_id");
create index "work_versions_work_id_idx" on "work_versions" ("work_id");
create index "tags_name_norm_idx" on "tags" ("name_norm", "type");
create index "work_tags_tag_id_idx" on "work_tags" ("tag_id");
`;
