import type { ColumnType, Generated } from "kysely";

// Column names are the database's (snake_case, as in ARCHITECTURE's Data model).
// Better Auth reads and writes them through `authSchema`'s field mapping.

/** A timestamptz: read as a Date, written as a Date or an ISO string. */
type Timestamp = ColumnType<Date, Date | string, Date | string>;
/** A timestamptz the database fills in when the insert leaves it out. */
type CreatedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UserTable {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  image: string | null;
  created_at: CreatedTimestamp;
  updated_at: CreatedTimestamp;
  // Our fields (ARCHITECTURE, Data model).
  role: string | null;
  upload_quota_used: Generated<number>;
  banned_at: Timestamp | null;
  /** NULL until a new account accepts the terms. */
  terms_accepted_at: Timestamp | null;
  /** A signed-in reader turned the warnings screen off. */
  warnings_off: Generated<boolean>;
}

export interface SessionTable {
  id: string;
  user_id: string;
  token: string;
  expires_at: Timestamp;
  ip_address: string | null;
  user_agent: string | null;
  created_at: CreatedTimestamp;
  updated_at: Timestamp;
}

export interface AccountTable {
  id: string;
  user_id: string;
  account_id: string;
  provider_id: string;
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
  access_token_expires_at: Timestamp | null;
  refresh_token_expires_at: Timestamp | null;
  scope: string | null;
  /** Part of Better Auth's core schema. Never written: no passwords are stored. */
  password: string | null;
  created_at: CreatedTimestamp;
  updated_at: Timestamp;
}

/** Holds hashed magic-link tokens. */
export interface VerificationTable {
  id: string;
  identifier: string;
  value: string;
  expires_at: Timestamp;
  created_at: CreatedTimestamp;
  updated_at: CreatedTimestamp;
}

/** Better Auth's rate-limit counters, one row per limited key. */
export interface RateLimitTable {
  id: string;
  key: string;
  count: number;
  /** Milliseconds since the epoch. A bigint, so pg reads it as a string. */
  last_request: ColumnType<string, number | string, number | string>;
}

export type WorkStatus = "processing" | "live" | "hidden" | "removed";
export type HiddenCause = "removal_request" | "reports" | "moderator";
export type TagType =
  | "fandom"
  | "relationship"
  | "character"
  | "freeform"
  | "warning"
  | "category"
  | "rating";
/** The pipeline's statuses, then the rejection codes (ARCHITECTURE, Ingestion pipeline). */
export type UploadStatus =
  | "pending"
  | "processing"
  | "live"
  | "held_for_review"
  | "duplicate"
  | "not_epub"
  | "zip_bomb"
  | "too_large"
  | "not_ao3"
  | "opted_out"
  | "parse_failed";

export interface WorkTable {
  id: Generated<string>;
  /** The URL key. */
  ao3_work_id: number;
  title: string;
  summary_html: string | null;
  rating: string | null;
  language: string | null;
  words: number | null;
  chapters_count: number;
  /** The planned total (AO3's y in x/y). NULL when unknown. */
  chapters_total: number | null;
  complete: boolean;
  /** AO3's dates for the work, not the row's. */
  published_at: Timestamp | null;
  updated_at: Timestamp | null;
  status: ColumnType<WorkStatus, WorkStatus | undefined, WorkStatus>;
  /** Set while, and only while, the work is hidden. */
  hidden_cause: HiddenCause | null;
  /** NULL only while the first version is being written. */
  current_version_id: string | null;
  /** Preface labels the parser doesn't understand yet. Write it with `JSON.stringify`. */
  raw_meta: ColumnType<Record<string, string>, string | undefined, string>;
  /** Filled by search, not here. */
  search: string | null;
}

export interface WorkAuthorTable {
  work_id: string;
  pseud: string;
  /** NULL for an anonymous work, or a byline with no user link. */
  ao3_user: string | null;
  /** The author's place in the byline, from 0. Unique per work. */
  position: number;
}

export interface WorkVersionTable {
  id: Generated<string>;
  work_id: string;
  upload_id: string;
  chapter_count: number;
  /** The planned total as this version's preface gave it. NULL when unknown. */
  chapter_total: number | null;
  /** `works/<ao3_work_id>/<upload_id>/`, with the trailing slash. */
  r2_prefix: string;
  created_at: CreatedTimestamp;
  /** From the parser. Non-empty, with `checked_at` still NULL, shows the "may be imperfect" notice. */
  review_reasons: ColumnType<string[], string[] | undefined, string[]>;
  /** Set when a moderator approves the version. */
  checked_at: Timestamp | null;
}

export interface ChapterTable {
  work_id: string;
  version_id: string;
  n: number;
  title: string;
  words: number;
  /** The fragment's whole R2 key. Readers use it as is. */
  r2_key: string;
}

export interface TagTable {
  id: Generated<string>;
  type: TagType;
  /** Exactly as written. */
  name: string;
  /** `normalizeTagName(type, name)`, used for matching. */
  name_norm: string;
}

export interface WorkTagTable {
  work_id: string;
  tag_id: string;
  /** The tag's place in the work's tags, in the author's order. */
  position: number;
}

export interface UploadTable {
  id: Generated<string>;
  user_id: string;
  r2_key: string;
  /** NULL until `/complete` hashes the file. */
  sha256: string | null;
  bytes: number;
  status: ColumnType<UploadStatus, UploadStatus | undefined, UploadStatus>;
  lease_until: Timestamp | null;
  error_stage: string | null;
  error: string | null;
  work_id: string | null;
  created_at: CreatedTimestamp;
}

export interface Database {
  user: UserTable;
  session: SessionTable;
  account: AccountTable;
  verification: VerificationTable;
  works: WorkTable;
  work_authors: WorkAuthorTable;
  work_versions: WorkVersionTable;
  chapters: ChapterTable;
  tags: TagTable;
  work_tags: WorkTagTable;
  uploads: UploadTable;
  rateLimit: RateLimitTable;
}
