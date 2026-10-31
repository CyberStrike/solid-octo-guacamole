// Every migration, in the order it applies. Append new ones; never edit or
// reorder an entry once merged. The name is what `schema_migrations` records.
import m0001 from "./0001_better_auth";
import m0002 from "./0002_catalogue_and_uploads";

export const migrations: ReadonlyArray<{ name: string; sql: string }> = [
  { name: "0001_better_auth", sql: m0001 },
  { name: "0002_catalogue_and_uploads", sql: m0002 },
];
