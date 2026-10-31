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

const later = new Date("2030-01-01T00:00:00Z");

async function addUser(id: string, email = `${id}@example.test`) {
  await t.db.insertInto("user").values({ id, name: id, email, email_verified: false }).execute();
}

async function addSession(id: string, userId: string, token = `token-${id}`) {
  await t.db
    .insertInto("session")
    .values({ id, user_id: userId, token, expires_at: later, updated_at: later })
    .execute();
}

describe("packages/db user fields", () => {
  it("A new user has the Data model's defaults", async () => {
    await addUser("defaults");
    const row = await t.db
      .selectFrom("user")
      .select(["role", "upload_quota_used", "banned_at", "terms_accepted_at", "warnings_off"])
      .where("id", "=", "defaults")
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      role: null,
      upload_quota_used: 0,
      banned_at: null,
      terms_accepted_at: null,
      warnings_off: false,
    });
  });
});

describe("packages/db constraints", () => {
  it("A second user with the same email is refused", async () => {
    await addUser("first", "same@example.test");
    await expect(addUser("second", "same@example.test")).rejects.toThrow(/unique/i);
  });

  it("A second session with the same token is refused", async () => {
    await addUser("tokens");
    await addSession("s1", "tokens", "same-token");
    await expect(addSession("s2", "tokens", "same-token")).rejects.toThrow(/unique/i);
  });

  it("A session for a user who doesn't exist is refused", async () => {
    await expect(addSession("orphan", "nobody")).rejects.toThrow(/foreign key/i);
  });

  it("Deleting a user deletes their sessions and accounts", async () => {
    await addUser("leaving");
    await addSession("leaving-s", "leaving");
    await t.db
      .insertInto("account")
      .values({
        id: "leaving-a",
        user_id: "leaving",
        account_id: "leaving",
        provider_id: "magic-link",
        updated_at: later,
      })
      .execute();

    await t.db.deleteFrom("user").where("id", "=", "leaving").execute();

    const sessions = await t.db
      .selectFrom("session")
      .select("id")
      .where("user_id", "=", "leaving")
      .execute();
    const accounts = await t.db
      .selectFrom("account")
      .select("id")
      .where("user_id", "=", "leaving")
      .execute();
    expect(sessions).toEqual([]);
    expect(accounts).toEqual([]);
  });
});
