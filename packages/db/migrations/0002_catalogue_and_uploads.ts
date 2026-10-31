// The catalogue (works, their authors, versions, chapters and tags) and the
// uploads that produce it, from ARCHITECTURE's Data model. Chapter text is in
// R2, never here. Add-only: never edit this file once merged.
export default /* sql */ `
create table "works" (
  "id" text not null primary key default gen_random_uuid()::text,
  "ao3_work_id" integer not null,
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
  "search" tsvector
);

create table "uploads" (
  "id" text not null primary key default gen_random_uuid()::text,
  "user_id" text not null,
  "r2_key" text not null,
  "sha256" text,
  "bytes" integer not null,
  "status" text not null default 'pending',
  "lease_until" timestamptz,
  "error_stage" text,
  "error" text,
  "work_id" text,
  "created_at" timestamptz not null default current_timestamp
);

create table "work_versions" (
  "id" text not null primary key default gen_random_uuid()::text,
  "work_id" text not null,
  "upload_id" text not null,
  "chapter_count" integer not null,
  "r2_prefix" text not null,
  "created_at" timestamptz not null default current_timestamp,
  "review_reasons" text[] not null default '{}',
  "checked_at" timestamptz
);

create table "chapters" (
  "work_id" text not null,
  "version_id" text not null,
  "n" integer not null,
  "title" text not null,
  "words" integer not null,
  "r2_key" text not null
);

create table "tags" (
  "id" text not null primary key default gen_random_uuid()::text,
  "type" text not null,
  "name" text not null,
  "name_norm" text not null
);

create table "work_tags" (
  "work_id" text not null,
  "tag_id" text not null,
  "position" integer not null
);

create table "work_authors" (
  "work_id" text not null,
  "pseud" text not null,
  "ao3_user" text
);
`;
