import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
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
const sent: { email: string; token: string }[] = [];

// The real Better Auth over the exported db and field mapping, configured as
// ARCHITECTURE's Auth section describes. No mail is sent: the link is captured.
function makeAuth() {
  return betterAuth({
    ...authSchema,
    baseURL: BASE_URL,
    secret: "test-only-auth-value-not-used-anywhere-else",
    database: { db: t.db, type: "postgres" },
    telemetry: { enabled: false },
    rateLimit: { enabled: false },
    advanced: { useSecureCookies: true },
    plugins: [
      magicLink({
        storeToken: "hashed",
        expiresIn: 900,
        sendMagicLink: async ({ email, token }) => {
          sent.push({ email, token });
        },
      }),
    ],
  });
}

describe("packages/db with Better Auth", () => {
  it("A magic-link sign-in reads and writes the snake_case tables", async () => {
    const auth = makeAuth();
    const headers = new Headers({ origin: BASE_URL });

    await auth.api.signInMagicLink({ body: { email: "reader@example.test" }, headers });
    expect(sent).toHaveLength(1);
    const { token } = sent[0]!;

    const pending = await t.db
      .selectFrom("verification")
      .select(["identifier", "value", "expires_at"])
      .execute();
    expect(pending).toHaveLength(1);
    // Stored hashed: neither column holds the token that was mailed.
    expect(pending[0]!.identifier).not.toContain(token);
    expect(pending[0]!.value).not.toContain(token);
    // 15 minutes from now (ARCHITECTURE, Auth), within a minute's slack.
    const lifetime = pending[0]!.expires_at.getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(14 * 60_000);
    expect(lifetime).toBeLessThanOrEqual(15 * 60_000);

    await auth.api.magicLinkVerify({ query: { token }, headers });

    const user = await t.db
      .selectFrom("user")
      .select([
        "id",
        "email",
        "email_verified",
        "terms_accepted_at",
        "warnings_off",
        "upload_quota_used",
      ])
      .where("email", "=", "reader@example.test")
      .executeTakeFirstOrThrow();
    expect(user).toMatchObject({
      email_verified: true,
      terms_accepted_at: null,
      warnings_off: false,
      upload_quota_used: 0,
    });

    const sessions = await t.db
      .selectFrom("session")
      .select(["user_id", "token"])
      .where("user_id", "=", user.id)
      .execute();
    expect(sessions).toHaveLength(1);

    // Single use: the token's row is gone once the link is used, and using the
    // link again starts no second session.
    expect(await t.db.selectFrom("verification").select("id").execute()).toEqual([]);
    await auth.api.magicLinkVerify({ query: { token }, headers }).catch(() => undefined);
    const after = await t.db
      .selectFrom("session")
      .select("id")
      .where("user_id", "=", user.id)
      .execute();
    expect(after).toHaveLength(1);
  });
});
