export { createDb, type DbConfig } from "./client";
export { migrate } from "./migrate";
export { authSchema } from "./auth-schema";
export type {
  Database, UserTable, SessionTable, AccountTable, VerificationTable,
} from "./schema";
