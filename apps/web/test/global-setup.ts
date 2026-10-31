import { createTestDb } from "@archive/db/testing";
import type { TestProject } from "vitest/node";
import { oneClientAtATime } from "./one-client-at-a-time";

// workerd can't run PGlite, so the test database starts here in Node, migrated,
// and the Worker reaches it through its Hyperdrive binding. One database serves
// every test file of a project (each workerd project gets its own): tests use
// their own email addresses rather than a reset.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // The setup's own client, plus room for the Worker's per-request pools.
  const t = await createTestDb({ maxConnections: 64 });
  // PGlite is one session: concurrent requests reach it one client at a time.
  const proxy = await oneClientAtATime(t.connectionString);
  project.provide("databaseUrl", proxy.connectionString);
  return async () => {
    await proxy.close();
    await t.close();
  };
}
