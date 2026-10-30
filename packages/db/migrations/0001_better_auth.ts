// Better Auth's core tables (1.7.14, Postgres, magic-link plugin), with its
// camelCase fields as snake_case columns, plus our `user` fields from
// ARCHITECTURE's Data model. Add-only: never edit this file once merged.
export default /* sql */ `
create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "email_verified" boolean not null,
  "image" text,
  "created_at" timestamptz not null default current_timestamp,
  "updated_at" timestamptz not null default current_timestamp,
  "role" text,
  "upload_quota_used" integer not null default 0,
  "banned_at" timestamptz,
  "terms_accepted_at" timestamptz,
  "warnings_off" boolean not null default false
);

create table "session" (
  "id" text not null primary key,
  "expires_at" timestamptz not null,
  "token" text not null unique,
  "created_at" timestamptz not null default current_timestamp,
  "updated_at" timestamptz not null,
  "ip_address" text,
  "user_agent" text,
  "user_id" text not null references "user" ("id") on delete cascade
);

create table "account" (
  "id" text not null primary key,
  "account_id" text not null,
  "provider_id" text not null,
  "user_id" text not null references "user" ("id") on delete cascade,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamptz,
  "refresh_token_expires_at" timestamptz,
  "scope" text,
  "password" text,
  "created_at" timestamptz not null default current_timestamp,
  "updated_at" timestamptz not null
);

create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expires_at" timestamptz not null,
  "created_at" timestamptz not null default current_timestamp,
  "updated_at" timestamptz not null default current_timestamp
);

create index "session_user_id_idx" on "session" ("user_id");
create index "account_user_id_idx" on "account" ("user_id");
create index "verification_identifier_idx" on "verification" ("identifier");
`;
