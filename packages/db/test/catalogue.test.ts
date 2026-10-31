import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../src/testing";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- unset if beforeAll failed
  await t?.close();
});

// Expected columns: ARCHITECTURE's Data model for the catalogue and uploads,
// plus `work_tags.position` (the author's order of a work's tags).
const expected = {
  works: {
    id: { type: "text", nullable: false },
    ao3_work_id: { type: "int4", nullable: false },
    title: { type: "text", nullable: false },
    summary_html: { type: "text", nullable: true },
    rating: { type: "text", nullable: true },
    language: { type: "text", nullable: true },
    words: { type: "int4", nullable: true },
    chapters_count: { type: "int4", nullable: false },
    complete: { type: "bool", nullable: false },
    published_at: { type: "timestamptz", nullable: true },
    updated_at: { type: "timestamptz", nullable: true },
    status: { type: "text", nullable: false },
    hidden_cause: { type: "text", nullable: true },
    current_version_id: { type: "text", nullable: true },
    raw_meta: { type: "jsonb", nullable: false },
    search: { type: "tsvector", nullable: true },
  },
  work_authors: {
    work_id: { type: "text", nullable: false },
    pseud: { type: "text", nullable: false },
    ao3_user: { type: "text", nullable: true },
  },
  work_versions: {
    id: { type: "text", nullable: false },
    work_id: { type: "text", nullable: false },
    upload_id: { type: "text", nullable: false },
    chapter_count: { type: "int4", nullable: false },
    r2_prefix: { type: "text", nullable: false },
    created_at: { type: "timestamptz", nullable: false },
    review_reasons: { type: "_text", nullable: false },
    checked_at: { type: "timestamptz", nullable: true },
  },
  chapters: {
    work_id: { type: "text", nullable: false },
    version_id: { type: "text", nullable: false },
    n: { type: "int4", nullable: false },
    title: { type: "text", nullable: false },
    words: { type: "int4", nullable: false },
    r2_key: { type: "text", nullable: false },
  },
  tags: {
    id: { type: "text", nullable: false },
    type: { type: "text", nullable: false },
    name: { type: "text", nullable: false },
    name_norm: { type: "text", nullable: false },
  },
  work_tags: {
    work_id: { type: "text", nullable: false },
    tag_id: { type: "text", nullable: false },
    position: { type: "int4", nullable: false },
  },
  uploads: {
    id: { type: "text", nullable: false },
    user_id: { type: "text", nullable: false },
    r2_key: { type: "text", nullable: false },
    sha256: { type: "text", nullable: true },
    bytes: { type: "int4", nullable: false },
    status: { type: "text", nullable: false },
    lease_until: { type: "timestamptz", nullable: true },
    error_stage: { type: "text", nullable: true },
    error: { type: "text", nullable: true },
    work_id: { type: "text", nullable: true },
    created_at: { type: "timestamptz", nullable: false },
  },
} satisfies Record<string, Record<string, { type: string; nullable: boolean }>>;

describe("packages/db catalogue and uploads", () => {
  it("The catalogue and uploads tables have the Data model's columns", async () => {
    const tables = await t.db.introspection.getTables();
    for (const [table, columns] of Object.entries(expected)) {
      const found = tables.find((x) => x.name === table);
      expect(found, `table ${table}`).toBeDefined();
      const actual = Object.fromEntries(
        found!.columns.map((c) => [c.name, { type: c.dataType, nullable: c.isNullable }]),
      );
      expect(actual, `columns of ${table}`).toEqual(columns);
    }
  });
});
