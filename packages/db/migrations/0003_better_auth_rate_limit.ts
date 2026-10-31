// Better Auth's rate-limit counters (1.7.14, `rateLimit.storage: "database"`), so
// they are shared by every isolate rather than kept in each one's memory
// (ARCHITECTURE, Auth). The table keeps Better Auth's model name; `lastRequest`
// is `last_request`, milliseconds since the epoch. Add-only: never edit this
// file once merged.
export default /* sql */ `
create table "rateLimit" (
  "id" text not null primary key,
  "key" text not null unique,
  "count" integer not null,
  "last_request" bigint not null
);
`;
