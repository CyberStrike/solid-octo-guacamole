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

// Expected columns: ARCHITECTURE's Data model for the wait list. Nothing else: no
// IP address, user agent or referrer.
const expected = {
  email: { type: "text", nullable: false },
  confirm_token_hash: { type: "text", nullable: true },
  confirm_sent_at: { type: "timestamptz", nullable: false },
  confirm_count: { type: "int4", nullable: false },
  confirmed_at: { type: "timestamptz", nullable: true },
  notified_at: { type: "timestamptz", nullable: true },
  unsubscribe_token_hash: { type: "text", nullable: true },
  created_at: { type: "timestamptz", nullable: false },
};

describe("packages/db wait list", () => {
  it("The waitlist table has the Data model's columns", async () => {
    const tables = await t.db.introspection.getTables();
    const found = tables.find((x) => x.name === "waitlist");
    expect(found).toBeDefined();
    const actual = Object.fromEntries(
      found!.columns.map((c) => [c.name, { type: c.dataType, nullable: c.isNullable }]),
    );
    expect(actual).toEqual(expected);
  });

  it("A new address has had one confirmation email and is not confirmed", async () => {
    const row = await t.db
      .insertInto("waitlist")
      .values({ email: "new@example.test", confirm_token_hash: "hash-new" })
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      confirm_count: 1,
      confirmed_at: null,
      notified_at: null,
      unsubscribe_token_hash: null,
    });
    expect(row.confirm_sent_at).toBeInstanceOf(Date);
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it("An address is on the list once", async () => {
    await t.db.insertInto("waitlist").values({ email: "once@example.test" }).execute();
    await expect(
      t.db.insertInto("waitlist").values({ email: "once@example.test" }).execute(),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("Two rows can't share a confirmation token hash", async () => {
    await t.db
      .insertInto("waitlist")
      .values({ email: "first@example.test", confirm_token_hash: "same-hash" })
      .execute();
    await expect(
      t.db
        .insertInto("waitlist")
        .values({ email: "second@example.test", confirm_token_hash: "same-hash" })
        .execute(),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});
