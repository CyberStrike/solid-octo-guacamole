import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLiveWork } from "../src/index";
import { seedVersion, seedWork } from "../src/seed";
import { createTestDb, type TestDb } from "../src/testing";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- unset if beforeAll failed
  await t?.close();
});

describe("@archive/db/seed seedWork", () => {
  it("A seeded work is live with its chapters, authors and tags", async () => {
    const s = await seedWork(t.db, {
      ao3WorkId: 5001,
      title: "Seeded",
      authors: [{ pseud: "first", ao3_user: "first_user" }],
      tags: [
        { type: "relationship", name: "B/C" },
        { type: "fandom", name: "Seed Fandom" },
        { type: "relationship", name: "A/B" },
      ],
      chapters: 5,
    });

    const work = await getLiveWork(t.db, 5001);

    expect(work?.work).toMatchObject({ id: s.workId, ao3_work_id: 5001, title: "Seeded" });
    expect(work?.work.status).toBe("live");
    expect(work?.authors).toEqual([{ pseud: "first", ao3_user: "first_user" }]);
    // In the author's order, whatever the type.
    expect(work?.tags.map((x) => [x.type, x.name])).toEqual([
      ["relationship", "B/C"],
      ["fandom", "Seed Fandom"],
      ["relationship", "A/B"],
    ]);
    expect(work?.tags[0]?.name_norm).toBe("b/c");
    expect(work?.version.id).toBe(s.versionId);
    expect(work?.chapters.map((c) => c.n)).toEqual([1, 2, 3, 4, 5]);
    expect(work?.chapters.map((c) => c.r2_key)).toEqual(s.chapterKeys);
  });

  it("Chapter keys sit under the version's prefix, one fragment each", async () => {
    const s = await seedWork(t.db, {
      chapters: [{ title: "One", html: "<p>first</p>" }, { html: "<p>second</p>" }],
    });

    expect(s.r2Prefix).toBe(`works/${s.ao3WorkId}/${s.uploadId}/`);
    expect(s.chapterKeys).toEqual([`${s.r2Prefix}1.html`, `${s.r2Prefix}2.html`]);
    expect(s.fragments).toEqual([
      { key: `${s.r2Prefix}1.html`, body: "<p>first</p>" },
      { key: `${s.r2Prefix}2.html`, body: "<p>second</p>" },
    ]);
    const work = await getLiveWork(t.db, s.ao3WorkId);
    expect(work?.version.r2_prefix).toBe(s.r2Prefix);
    expect(work?.chapters[0]?.title).toBe("One");
  });

  it("An anonymous work is stored as Anonymous", async () => {
    const s = await seedWork(t.db, { anonymous: true });
    const work = await getLiveWork(t.db, s.ao3WorkId);
    expect(work?.authors).toEqual([{ pseud: "Anonymous", ao3_user: null }]);
  });

  it("Review reasons are kept on the version", async () => {
    const s = await seedWork(t.db, { reviewReasons: ["chapter_count_mismatch"] });
    const work = await getLiveWork(t.db, s.ao3WorkId);
    expect(work?.version.review_reasons).toEqual(["chapter_count_mismatch"]);
    expect(work?.version.checked_at).toBeNull();
  });

  it("Hidden and removed works are not read as live", async () => {
    const hidden = await seedWork(t.db, { status: "hidden", hiddenCause: "reports" });
    const removed = await seedWork(t.db, { status: "removed" });
    expect(await getLiveWork(t.db, hidden.ao3WorkId)).toBeNull();
    expect(await getLiveWork(t.db, removed.ao3WorkId)).toBeNull();
    const row = await t.db
      .selectFrom("works")
      .select(["status", "hidden_cause"])
      .where("id", "=", hidden.workId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "hidden", hidden_cause: "reports" });
  });

  it("A default seed carries its rating as a tag too", async () => {
    const s = await seedWork(t.db, { rating: "Mature" });
    const work = await getLiveWork(t.db, s.ao3WorkId);
    expect(work?.work.rating).toBe("Mature");
    expect(work?.tags.filter((x) => x.type === "rating").map((x) => x.name)).toEqual(["Mature"]);
    expect(work?.tags.map((x) => x.type)).toContain("warning");
  });

  it("A work nobody seeded is not found", async () => {
    expect(await getLiveWork(t.db, 2_147_483_647)).toBeNull();
  });

  it("A work ID no work can have is not found", async () => {
    expect(await getLiveWork(t.db, 2_147_483_648)).toBeNull();
    expect(await getLiveWork(t.db, 1.5)).toBeNull();
    expect(await getLiveWork(t.db, 0)).toBeNull();
  });

  it("Two seeds of one tag share its row", async () => {
    const a = await seedWork(t.db, { tags: [{ type: "freeform", name: "Shared Seed Tag" }] });
    const b = await seedWork(t.db, { tags: [{ type: "freeform", name: "Shared Seed Tag" }] });
    const [wa, wb] = await Promise.all([
      getLiveWork(t.db, a.ao3WorkId),
      getLiveWork(t.db, b.ao3WorkId),
    ]);
    expect(wa?.tags[0]?.id).toBeDefined();
    expect(wa?.tags[0]?.id).toBe(wb?.tags[0]?.id);
  });
});

describe("@archive/db/seed seedVersion", () => {
  it("A replacing version gets its own prefix and becomes current", async () => {
    const first = await seedWork(t.db, { chapters: 2 });
    const second = await seedVersion(t.db, first, { chapters: 3 });

    expect(second.r2Prefix).not.toBe(first.r2Prefix);
    expect(second.r2Prefix).toBe(`works/${first.ao3WorkId}/${second.uploadId}/`);
    expect(second.chapterKeys.filter((k) => first.chapterKeys.includes(k))).toEqual([]);
    const work = await getLiveWork(t.db, first.ao3WorkId);
    expect(work?.version.id).toBe(second.versionId);
    expect(work?.chapters.map((c) => c.r2_key)).toEqual(second.chapterKeys);
    expect(work?.work.chapters_count).toBe(3);
  });

  it("A held version is kept but does not become current", async () => {
    const first = await seedWork(t.db);
    const held = await seedVersion(t.db, first, { current: false });

    const work = await getLiveWork(t.db, first.ao3WorkId);
    expect(work?.version.id).toBe(first.versionId);
    const upload = await t.db
      .selectFrom("uploads")
      .select("status")
      .where("id", "=", held.uploadId)
      .executeTakeFirstOrThrow();
    expect(upload.status).toBe("held_for_review");
  });
});

describe("@archive/db/seed in workerd", () => {
  it("The seed module imports neither pg nor PGlite", async () => {
    const source = await readFile(new URL("../src/seed.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports.filter((x) => !["kysely", "./schema", "./tags"].includes(x ?? ""))).toEqual([]);
  });
});
