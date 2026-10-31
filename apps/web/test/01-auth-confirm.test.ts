import { createDb } from "@archive/db";
import { env } from "cloudflare:workers";
import { afterAll, describe, expect, it } from "vitest";
import { emailsTo, fetchW, PASSING_TOKEN, postLogin, STRICT, withoutNonce } from "./helpers";

// A2's cases from 01-auth-magic-link (and one from 09-content-origin): the emailed
// link's confirm page, and the POST that signs in. A1's cases are in 01-auth-magic-link.test.ts.

// The Postgres the Worker uses, through the same Hyperdrive binding. One database
// serves every test file of a project, so each test uses its own email address.
const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
afterAll(() => db.destroy());

/** Requests a sign-in link for `email` from /login, and returns the link it emails. */
async function signInLink(email: string, next?: string): Promise<URL> {
  const fields: Record<string, string> = { email, "cf-turnstile-response": PASSING_TOKEN };
  if (next !== undefined) fields.next = next;
  expect((await postLogin(fields)).status).toBe(200);
  const emails = await emailsTo(email);
  return new URL(emails.at(-1)!.url);
}

/**
 * The ids of the unspent tokens issued to `email`. By address, not by every row:
 * other test files issue tokens at the same time.
 */
const tokensFor = async (email: string) =>
  (
    await db
      .selectFrom("verification")
      .select("id")
      .where("value", "like", `%${JSON.stringify(email)}%`)
      .orderBy("id")
      .execute()
  ).map((r) => r.id);

/** Requests a sign-in link, and returns it with the id of the `verification` row it made. */
async function issued(email: string, next?: string) {
  const before = new Set(await tokensFor(email));
  const link = await signInLink(email, next);
  const made = (await tokensFor(email)).filter((id) => !before.has(id));
  expect(made).toHaveLength(1);
  return { link, row: made[0]!, token: link.searchParams.get("token")! };
}

/** The confirm page's POST, as a browser on rarepair.fans submits it. */
const confirm = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
  fetchW("/login/confirm", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://rarepair.fans",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });

/** The session cookies a response sets. */
const sessionCookies = (res: Response) =>
  res.headers.getSetCookie().filter((c) => c.startsWith("__Secure-better-auth.session_token="));

/** The id of `email`'s account, or null when it has none. */
const userId = async (email: string) =>
  (await db.selectFrom("user").select("id").where("email", "=", email).executeTakeFirst())?.id ??
  null;

/** How many sessions `email`'s account has: 0 when there is no account. */
async function sessionCount(email: string): Promise<number> {
  const id = await userId(email);
  if (id === null) return 0;
  const rows = await db.selectFrom("session").select("id").where("user_id", "=", id).execute();
  return rows.length;
}

describe("01-auth-magic-link", () => {
  it("Opening the emailed link uses nothing up", async () => {
    const email = "opening@example.test";
    const { link, row } = await issued(email, "/works/1");

    // The link as a mail scanner prefetches it.
    const res = await fetchW(link.href);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<form\b[^>]*method="post"[^>]*action="\/login\/confirm"[^>]*>/);
    expect(html).toMatch(
      new RegExp(`<input type="hidden" name="token" value="${link.searchParams.get("token")}">`),
    );
    expect(html).toContain('<input type="hidden" name="next" value="/works/1">');
    expect(html).toMatch(/<button type="submit">Sign in<\/button>/);

    // The token is still unused and no session is created.
    expect(await tokensFor(email)).toEqual([row]);
    expect(await sessionCount(email)).toBe(0);

    // The token is in the URL: it is never cached, nor sent on as a referrer.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(withoutNonce(res.headers.get("content-security-policy"))).toBe(STRICT);
  });

  it("Confirming signs the user in", async () => {
    const email = "confirming@example.test";
    const { row, token } = await issued(email);

    const res = await confirm({ token, next: "/" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://rarepair.fans/");
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );

    // The token's verification row is deleted, and a session row is created.
    expect(await tokensFor(email)).not.toContain(row);
    expect(await sessionCount(email)).toBe(1);

    // One cookie, with exactly the attributes ARCHITECTURE fixes, and Better Auth's
    // default lifetime of seven days.
    expect(res.headers.getSetCookie()).toHaveLength(1);
    const [cookie] = sessionCookies(res);
    const attributes = cookie!.split(/;\s*/).slice(1);
    expect(attributes.map((a) => a.toLowerCase())).toEqual(
      expect.arrayContaining(["httponly", "secure", "samesite=lax", "path=/", "max-age=604800"]),
    );
    // No Domain, so it covers rarepair.fans only, never content.rarepair.fans.
    expect(attributes.some((a) => /^domain=/i.test(a))).toBe(false);
  });
});
