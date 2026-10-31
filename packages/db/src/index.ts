export { createDb, type DbConfig } from "./client";
export { migrate } from "./migrate";
export { authSchema } from "./auth-schema";
export { normalizeTagName, compareTagKeys, compareCodeUnits } from "./tags";
export {
  getLiveWork,
  listLiveWorksByTag,
  insertUpload,
  type LiveWork,
  type WorkSummary,
} from "./queries";
export type {
  Database,
  UserTable,
  SessionTable,
  AccountTable,
  VerificationTable,
  WorkTable,
  WorkAuthorTable,
  WorkVersionTable,
  ChapterTable,
  TagTable,
  WorkTagTable,
  UploadTable,
  WorkStatus,
  HiddenCause,
  TagType,
  UploadStatus,
} from "./schema";
