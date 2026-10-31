import { createTestDb } from "@archive/db/testing";
import type { TestProject } from "vitest/node";

// workerd can't run PGlite, so the test database starts here in Node, migrated,
// and the Worker reaches it through its Hyperdrive binding. One database serves
// every test file: tests use their own email addresses rather than a reset.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // The setup's own client, plus room for the Worker's per-request pools.
  const t = await createTestDb({ maxConnections: 16 });
  project.provide("databaseUrl", t.connectionString);
  return () => t.close();
}
