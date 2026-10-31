import { createTestDb } from "@archive/db/testing";
import type { TestProject } from "vitest/node";

// workerd can't run PGlite, so the test database starts here in Node, migrated, and the
// Worker reaches it through its Hyperdrive binding. One database serves every test file:
// each test makes its own user and uploads rather than resetting it.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // The setup's own client, plus room for each queue invocation's pool and the tests' own,
  // in every file running at once: each test holds two or three connections at most.
  const t = await createTestDb({ maxConnections: 64 });
  project.provide("databaseUrl", t.connectionString);
  return () => t.close();
}
