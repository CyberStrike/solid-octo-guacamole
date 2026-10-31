import { betterAuth } from "better-auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authSchema } from "../src/index";
import { createTestDb, type TestDb } from "../src/testing";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- unset if beforeAll failed
  await t?.close();
});

const BASE_URL = "https://rarepair.test";

// Better Auth's own limiter keeps its counters in Postgres, not in a per-isolate
// memory store (ARCHITECTURE, Auth). It only runs for requests through
// auth.handler, so the test goes through it.
function makeAuth() {
  return betterAuth({
    ...authSchema,
    baseURL: BASE_URL,
    secret: "test-only-auth-value-not-used-anywhere-else",
    database: { db: t.db, type: "postgres" },
    telemetry: { enabled: false },
    rateLimit: { ...authSchema.rateLimit, enabled: true, storage: "database", window: 60, max: 2 },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
  });
}

const request = () =>
  new Request(`${BASE_URL}/api/auth/get-session`, {
    headers: { origin: BASE_URL, "cf-connecting-ip": "192.0.2.1" },
  });

describe("packages/db with Better Auth's rate limiter", () => {
  it("Better Auth's rate limiter counts requests in Postgres", async () => {
    // A fresh instance per request, as the Worker builds them: only the database is shared.
    const first = await makeAuth().handler(request());
    const second = await makeAuth().handler(request());
    const third = await makeAuth().handler(request());
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);

    const rows = await t.db
      .selectFrom("rateLimit")
      .select(["key", "count", "last_request"])
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toContain("192.0.2.1");
    expect(rows[0]!.count).toBe(2);
    // Milliseconds since the epoch, in a bigint column.
    expect(Math.abs(Number(rows[0]!.last_request) - Date.now())).toBeLessThan(60_000);
  });
});
