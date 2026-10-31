import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLiveWork, insertUpload, listLiveWorksByTag, normalizeTagName } from "../src/index";
import { seedWork } from "../src/seed";
import { createTestDb, type TestDb } from "../src/testing";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- unset if beforeAll failed
  await t?.close();
});

describe("14 browse and home", () => {
  it("Tag matching uses the normalized form", async () => {
    const a = await seedWork(t.db, { tags: [{ type: "fandom", name: "Harry Potter" }] });
    const b = await seedWork(t.db, { tags: [{ type: "fandom", name: "harry  potter!" }] });
    await seedWork(t.db, { tags: [{ type: "fandom", name: "Harry Potter - J. K. Rowling" }] });
    await seedWork(t.db, {
      status: "hidden",
      hiddenCause: "reports",
      tags: [{ type: "fandom", name: "Harry Potter" }],
    });

    const works = await listLiveWorksByTag(t.db, "fandom", "Harry Potter");

    expect(works.map((w) => w.id).sort()).toEqual([a.workId, b.workId].sort());
    const names = await Promise.all(
      [a, b].map(async (s) => (await getLiveWork(t.db, s.ao3WorkId))?.tags[0]?.name),
    );
    expect(names).toEqual(["Harry Potter", "harry  potter!"]);
  });
});

describe("packages/db tag listing", () => {
  it("A tag listing holds only tags of its own type", async () => {
    const fandom = await seedWork(t.db, { tags: [{ type: "fandom", name: "Listing Sherlock" }] });
    await seedWork(t.db, { tags: [{ type: "character", name: "Listing Sherlock" }] });

    const works = await listLiveWorksByTag(t.db, "fandom", "listing sherlock");

    expect(normalizeTagName("character", "Listing Sherlock")).toBe("listing sherlock");
    expect(works.map((w) => w.id)).toEqual([fandom.workId]);
  });
});

describe("packages/db uploads", () => {
  it("An inserted upload is pending, under the id the caller chose", async () => {
    const user = await seedWork(t.db);
    const id = crypto.randomUUID();

    const upload = await insertUpload(t.db, {
      id,
      userId: user.userId,
      r2Key: `uploads/${id}.epub`,
      bytes: 2048,
    });

    expect(upload).toEqual({ id, status: "pending" });
    const row = await t.db
      .selectFrom("uploads")
      .select(["user_id", "r2_key", "bytes", "status", "sha256"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      user_id: user.userId,
      r2_key: `uploads/${id}.epub`,
      bytes: 2048,
      status: "pending",
      sha256: null,
    });
  });
});
