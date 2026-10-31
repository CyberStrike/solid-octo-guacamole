import { createDb } from "@archive/db";
import { seedWork } from "@archive/db/seed";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emailsTo, fetchW, PASSING_TOKEN, postLogin } from "./helpers";

// One database serves every test file in the run, and each queue lists every open
// item in it. So this file keeps to AO3 work IDs 14000 to 14099, gives every row a
// marker starting "mod1-", seeds its rows in 2001 so they sort ahead of anyone
// else's, and asserts only the relative order of its own markers. Text is synthetic.
const WORK = 14000;

const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
afterAll(() => db.destroy());

/**
 * Signs `email` in through the Worker and gives the account `role`, with the terms
 * accepted. Returns the `name=value` of its session cookie. A copy of
 * session.test.ts's: A4 (#24) brings the shared one to helpers.ts.
 */
async function signIn(email: string, role: string | null): Promise<string> {
  expect((await postLogin({ email, "cf-turnstile-response": PASSING_TOKEN })).status).toBe(200);
  const [sent] = await emailsTo(email);
  const token = new URL(sent!.url).searchParams.get("token")!;
  const res = await postLogin({ token, next: "/" }, { url: "/login/confirm" });
  expect(res.status).toBe(303);
  await db
    .updateTable("user")
    .set({ role, terms_accepted_at: new Date() })
    .where("email", "=", email)
    .execute();
  return res.headers.getSetCookie()[0]!.split(";")[0]!;
}

const QUEUES = ["/admin/reports", "/admin/takedowns", "/admin/requests", "/admin/works"];

let moderator: string;
let workId: string;
let reporterId: string;

beforeAll(async () => {
  moderator = await signIn("mod1-moderator@example.test", "moderator");
  const seeded = await seedWork(db, {
    ao3WorkId: WORK,
    title: "mod1-work-title",
    tags: [{ type: "fandom", name: "mod1-Fandom" }],
  });
  workId = seeded.workId;
  reporterId = seeded.userId;
  await db
    .insertInto("reports")
    .values({
      work_id: workId,
      reporter_id: reporterId,
      kind: "wrong_version",
      body: "mod1-report-seen",
      created_at: "2001-06-01T00:00:00Z",
    })
    .execute();
  await db
    .insertInto("takedowns")
    .values({
      work_id: workId,
      requester: "mod1-takedown-seen@example.test",
      basis: "mod1-basis-seen",
      created_at: "2001-06-01T00:00:00Z",
    })
    .execute();
  await db
    .insertInto("requests")
    .values({
      kind: "remove_work",
      work_id: workId,
      contact_email: "mod1-request-seen@example.test",
      statement: "mod1-statement-seen",
      ip_hash: "mod1-ip-hash",
      created_at: "2001-06-01T00:00:00Z",
    })
    .execute();
});

/** GETs `path` as the account whose cookie is `cookie`, or signed out. */
const get = (path: string, cookie?: string, init: RequestInit = {}) =>
  fetchW(path, { ...init, headers: cookie === undefined ? {} : { cookie } });

describe("18 moderation", () => {
  it("Moderator sees four queues", async () => {
    const pages = new Map<string, string>();
    for (const path of QUEUES) {
      const res = await get(path, moderator);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toMatch(/^text\/html/);
      expect(res.headers.get("cache-control"), path).toBe("no-store");
      const html = await res.text();
      expect(html, path).toMatch(/<table[\s>]/);
      expect(html, path).not.toMatch(/<script/i);
      pages.set(path, html);
    }
    expect(pages.get("/admin/reports")).toContain("mod1-report-seen");
    expect(pages.get("/admin/reports")).toContain("mod1-work-title");
    expect(pages.get("/admin/takedowns")).toContain("mod1-takedown-seen@example.test");
    expect(pages.get("/admin/takedowns")).toContain("mod1-basis-seen");
    expect(pages.get("/admin/requests")).toContain("mod1-request-seen@example.test");
    expect(pages.get("/admin/requests")).toContain("mod1-statement-seen");
  });
});
