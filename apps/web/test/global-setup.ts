import { createTestDb } from "@archive/db/testing";
import type { TestProject } from "vitest/node";

// workerd can't run PGlite, so the test database starts here in Node, migrated,
// and the Worker reaches it through its Hyperdrive binding. One database serves
// every test file of a project (each workerd project gets its own): tests use
// their own email addresses rather than a reset. createTestDb keeps each client's
// queries and transactions whole on PGlite's one session, so requests can run at
// once (its limits: packages/db/src/testing.ts and #248).
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // The setup's own client, plus room for the Worker's per-request pools.
  const t = await createTestDb({ maxConnections: 64 });
  project.provide("databaseUrl", t.connectionString);
  return () => t.close();
}
