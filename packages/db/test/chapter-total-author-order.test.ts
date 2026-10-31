import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrations } from "../migrations/index";
import { getLiveWork, migrate } from "../src/index";
import { seedVersion, seedWork } from "../src/seed";
import { createTestDb, type TestDb } from "../src/testing";

const MIGRATION = "0005_chapter_total_and_author_order";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- unset if beforeAll failed
  await t?.close();
});

/** A database as it was deployed before this item: every earlier migration applied and recorded. */
async function createDeployedDb(): Promise<TestDb> {
  const deployed = await createTestDb({ migrate: false });
  try {
    await sql`create table schema_migrations (
      name text primary key,
      applied_at timestamptz not null default current_timestamp
    )`.execute(deployed.db);
    const before = migrations.slice(
      0,
      migrations.findIndex((x) => x.name === MIGRATION),
    );
    for (const m of before) {
      await sql.raw(m.sql).execute(deployed.db);
      await sql`insert into schema_migrations (name) values (${m.name})`.execute(deployed.db);
    }
    return deployed;
  } catch (err) {
    await deployed.close();
    throw err;
  }
}

describe("packages/db chapter total and byline order", () => {
  it("The migration applies on top of the earlier ones, and a second run applies nothing", async () => {
    const deployed = await createDeployedDb();
    try {
      const first = await migrate(deployed.db);
      const second = await migrate(deployed.db);
      expect([first, second]).toEqual([[MIGRATION], []]);
    } finally {
      await deployed.close();
    }
  });

  it("Existing co-authors keep the order a reader saw, by pseud then user", async () => {
    const deployed = await createDeployedDb();
    try {
      await sql`insert into works (id, ao3_work_id, title, chapters_count, complete)
        values ('w1', 7001, 't', 1, true), ('w2', 7002, 't', 1, true)`.execute(deployed.db);
      await sql`insert into work_authors (work_id, pseud, ao3_user) values
        ('w2', 'Solo', null)`.execute(deployed.db);
      await sql`insert into work_authors (work_id, pseud, ao3_user) values
        ('w1', 'Zed', 'zed'), ('w1', 'Sam', 'bob'), ('w1', 'Sam', null), ('w1', 'Amy', 'amy')`.execute(
        deployed.db,
      );
      await migrate(deployed.db);
      const rows = await deployed.db
        .selectFrom("work_authors")
        .select(["pseud", "ao3_user", "position"])
        .where("work_id", "=", "w1")
        .orderBy("position")
        .execute();
      const solo = await deployed.db
        .selectFrom("work_authors")
        .select("position")
        .where("work_id", "=", "w2")
        .execute();
      const totals = await deployed.db.selectFrom("works").select("chapters_total").execute();
      expect({ solo, totals }).toEqual({
        solo: [{ position: 0 }],
        totals: [{ chapters_total: null }, { chapters_total: null }],
      });
      expect(rows).toEqual([
        { pseud: "Amy", ao3_user: "amy", position: 0 },
        { pseud: "Sam", ao3_user: null, position: 1 },
        { pseud: "Sam", ao3_user: "bob", position: 2 },
        { pseud: "Zed", ao3_user: "zed", position: 3 },
      ]);
    } finally {
      await deployed.close();
    }
  });

  it("A work's authors read back in the byline order they were given", async () => {
    const s = await seedWork(t.db, {
      authors: [
        { pseud: "Zed", ao3_user: "zed" },
        { pseud: "Amy", ao3_user: "amy" },
        { pseud: "Sam", ao3_user: null },
      ],
    });
    const work = await getLiveWork(t.db, s.ao3WorkId);
    expect(work?.authors).toEqual([
      { pseud: "Zed", ao3_user: "zed" },
      { pseud: "Amy", ao3_user: "amy" },
      { pseud: "Sam", ao3_user: null },
    ]);
  });

  it("Two authors of one work cannot share a position", async () => {
    const s = await seedWork(t.db, { authors: [{ pseud: "One", ao3_user: "one" }] });
    await expect(
      t.db
        .insertInto("work_authors")
        .values({ work_id: s.workId, pseud: "Two", ao3_user: "two", position: 0 })
        .execute(),
    ).rejects.toThrow(/unique|duplicate key/i);
  });

  it("A work's chapter total is returned, and null when unknown", async () => {
    const known = await seedWork(t.db, { chapters: 2, chapterTotal: 10 });
    const unknown = await seedWork(t.db, { chapters: 2, chapterTotal: null });
    const unset = await seedWork(t.db, { chapters: 2 });
    expect((await getLiveWork(t.db, known.ao3WorkId))?.work.chapters_total).toBe(10);
    expect((await getLiveWork(t.db, unknown.ao3WorkId))?.work.chapters_total).toBeNull();
    expect((await getLiveWork(t.db, unset.ao3WorkId))?.work.chapters_total).toBeNull();
  });

  it("A current version carries its chapter total to the work", async () => {
    const s = await seedWork(t.db, { chapters: 1, chapterTotal: 3 });
    await seedVersion(t.db, s, { chapters: 2, chapterTotal: 4 });
    const work = await getLiveWork(t.db, s.ao3WorkId);
    expect(work?.version.chapter_total).toBe(4);
    expect(work?.work.chapters_total).toBe(4);
  });

  it("A held version leaves the work's chapter total alone", async () => {
    const s = await seedWork(t.db, { chapters: 1, chapterTotal: 3 });
    await seedVersion(t.db, s, { chapters: 2, chapterTotal: 9, current: false });
    const work = await getLiveWork(t.db, s.ao3WorkId);
    expect(work?.work.chapters_total).toBe(3);
    expect(work?.version.chapter_total).toBe(3);
  });

  it("A chapter total below one is refused", async () => {
    const s = await seedWork(t.db);
    await expect(
      t.db.updateTable("works").set({ chapters_total: 0 }).where("id", "=", s.workId).execute(),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      t.db
        .updateTable("work_versions")
        .set({ chapter_total: 0 })
        .where("id", "=", s.versionId)
        .execute(),
    ).rejects.toThrow(/check constraint/i);
  });
});
