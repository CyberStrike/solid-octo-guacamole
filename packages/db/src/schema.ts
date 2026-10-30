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

export interface Database {
  user: UserTable;
  session: SessionTable;
  account: AccountTable;
  verification: VerificationTable;
}
