// Reports, DMCA notices (takedowns), removal and opt-out requests, opt-outs and
// requester blocks, from ARCHITECTURE's Data model. Only `requests.kind` has
// its values checked, because it is the only kind or status the docs list in
// full. `reports.kind` names just `wrong_version`, and the statuses are plain
// text with their first value as the default: `open` for a report, `pending`
// for a request or a notice. Emails are stored as given and matched with
// `lower()` on both sides. No raw IP is stored, only its hash. Nothing cascades:
// works are removed by status and accounts banned, never deleted.
// Add-only: never edit this file once merged. A new check is a new migration.
export default /* sql */ `
create table "reports" (
  "id" text not null primary key default gen_random_uuid()::text,
  "work_id" text not null references "works" ("id"),
  "reporter_id" text not null references "user" ("id"),
  "kind" text not null,
  "body" text,
  "status" text not null default 'open',
  "created_at" timestamptz not null default current_timestamp
);

create table "takedowns" (
  "id" text not null primary key default gen_random_uuid()::text,
  "work_id" text not null references "works" ("id"),
  "requester" text not null,
  "basis" text not null,
  "status" text not null default 'pending',
  "resolved_by" text references "user" ("id"),
  "created_at" timestamptz not null default current_timestamp
);

create table "requests" (
  "id" text not null primary key default gen_random_uuid()::text,
  "kind" text not null,
  "work_id" text references "works" ("id"),
  "pseud_norm" text,
  "contact_email" text not null,
  "statement" text not null,
  "status" text not null default 'pending',
  "ip_hash" text not null,
  "created_at" timestamptz not null default current_timestamp,
  constraint "requests_kind_check"
    check ("kind" in ('remove_work', 'opt_out')),
  -- A removal names a work in the archive; an opt-out, a pseud.
  constraint "requests_remove_work_has_work"
    check ("kind" <> 'remove_work' or "work_id" is not null),
  constraint "requests_opt_out_has_pseud"
    check ("kind" <> 'opt_out' or "pseud_norm" is not null),
  -- normalizePseud gives "" for a blank pseud, which would match every blank byline.
  constraint "requests_pseud_norm_not_blank" check ("pseud_norm" <> ''),
  -- A blank email or hash would match every other blank one, or nothing.
  constraint "requests_contact_email_not_blank" check ("contact_email" <> ''),
  constraint "requests_ip_hash_not_blank" check ("ip_hash" <> '')
);

-- No unique on pseud_norm: two requests can opt one pseud out, and a reversed
-- opt-out stays as an inactive row. No default on active: every writer says.
create table "optouts" (
  "id" text not null primary key default gen_random_uuid()::text,
  "pseud_norm" text not null
    constraint "optouts_pseud_norm_not_blank" check ("pseud_norm" <> ''),
  "ao3_user" text,
  "request_id" text not null references "requests" ("id"),
  "active" boolean not null,
  "created_at" timestamptz not null default current_timestamp
);

create table "requester_blocks" (
  "id" text not null primary key default gen_random_uuid()::text,
  "contact_email" text,
  "ip_hash" text,
  "created_by" text not null references "user" ("id"),
  "created_at" timestamptz not null default current_timestamp,
  constraint "requester_blocks_email_or_ip_hash"
    check ("contact_email" is not null or "ip_hash" is not null),
  constraint "requester_blocks_contact_email_not_blank" check ("contact_email" <> ''),
  constraint "requester_blocks_ip_hash_not_blank" check ("ip_hash" <> '')
);

create index "reports_work_id_idx" on "reports" ("work_id");
create index "reports_reporter_id_idx" on "reports" ("reporter_id");
create index "reports_status_created_at_idx" on "reports" ("status", "created_at");
create index "takedowns_work_id_idx" on "takedowns" ("work_id");
create index "takedowns_status_created_at_idx" on "takedowns" ("status", "created_at");
create index "takedowns_resolved_by_idx" on "takedowns" ("resolved_by");
create index "requests_work_id_idx" on "requests" ("work_id");
create index "requests_pseud_norm_idx" on "requests" ("pseud_norm");
create index "requests_contact_email_idx" on "requests" (lower("contact_email"));
create index "requests_ip_hash_idx" on "requests" ("ip_hash");
create index "requests_status_created_at_idx" on "requests" ("status", "created_at");
-- The ingest check.
create index "optouts_active_pseud_norm_idx" on "optouts" ("pseud_norm") where "active";
create index "optouts_request_id_idx" on "optouts" ("request_id");
create index "requester_blocks_contact_email_idx"
  on "requester_blocks" (lower("contact_email"));
create index "requester_blocks_ip_hash_idx" on "requester_blocks" ("ip_hash");
create index "requester_blocks_created_by_idx" on "requester_blocks" ("created_by");
`;
