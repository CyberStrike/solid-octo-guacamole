import { createDb } from "@archive/db";
import { seedWork } from "@archive/db/seed";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASE,
  emailsTo,
  fetchW,
  nonceOf,
  PASSING_TOKEN,
  postLogin,
  STRICT,
  withoutNonce,
} from "./helpers";

// One database serves every test file in the run, so this file keeps to AO3 work
// IDs 12500 to 12599, names every tag it seeds with an "x4-" prefix, and finds its
// reports by its own reporters. Text is synthetic.
const W = 12500;
const REPORT = `/works/${W}/report`;
/** Where a signed-out reader is sent: the sign-in form, carrying the report form's path. */
const TO_SIGN_IN = `/login?next=${encodeURIComponent(REPORT)}`;

const X4_TAGS = [
  { type: "rating", name: "x4-General Audiences" },
  { type: "fandom", name: "x4-Fandom" },
] as const;

const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });

beforeAll(async () => {
  await seedWork(db, { ao3WorkId: W, title: "x4 Work W", tags: [...X4_TAGS] });
});
afterAll(() => db.destroy());

/**
 * Signs `email` in through the Worker and returns the `name=value` of its session
 * cookie. The terms are marked accepted, so the account passes A4's terms gate
 * (#24) whether or not that has merged. A copy of session.test.ts's helper until
 * A4's shared one lands.
 */
async function signIn(email: string): Promise<string> {
  expect((await postLogin({ email, "cf-turnstile-response": PASSING_TOKEN })).status).toBe(200);
  const [sent] = await emailsTo(email);
  const token = new URL(sent!.url).searchParams.get("token")!;
  const res = await postLogin({ token, next: "/" }, { url: "/login/confirm" });
  expect(res.status).toBe(303);
  await db
    .updateTable("user")
    .set({ terms_accepted_at: new Date() })
    .where("email", "=", email)
    .execute();
  return res.headers.getSetCookie()[0]!.split(";")[0]!;
}

/** The headers a browser on rarepair.fans sends with the report form. */
const FORM_HEADERS = {
  "content-type": "application/x-www-form-urlencoded",
  origin: BASE,
  "sec-fetch-site": "same-origin",
};

/** Submits the report form for work `id`, as a browser on rarepair.fans does. */
const postReport = (
  fields: Record<string, string>,
  {
    cookie,
    id = W,
    headers = {},
  }: { cookie?: string; id?: number | string; headers?: Record<string, string> } = {},
) =>
  fetchW(`/works/${id}/report`, {
    method: "POST",
    headers: { ...FORM_HEADERS, ...(cookie === undefined ? {} : { cookie }), ...headers },
    body: new URLSearchParams(fields).toString(),
  });

/** How many reports work `ao3WorkId` has, from anyone. */
const reportCount = async (ao3WorkId = W) =>
  (
    await db
      .selectFrom("reports")
      .innerJoin("works", "works.id", "reports.work_id")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("works.ao3_work_id", "=", ao3WorkId)
      .executeTakeFirstOrThrow()
  ).n;

/** The reports `email`'s account has made on W, oldest first. */
const reportsBy = (email: string) =>
  db
    .selectFrom("reports")
    .innerJoin("works", "works.id", "reports.work_id")
    .innerJoin("user", "user.id", "reports.reporter_id")
    .select(["reports.kind", "reports.body", "reports.status"])
    .where("works.ao3_work_id", "=", W)
    .where("user.email", "=", email)
    .orderBy("reports.created_at")
    .execute();

describe("17-reports-and-dmca", () => {
  it("Every work has a report button", async () => {
    const res = await fetchW(`/works/${W}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`<a href="/works/${W}/report">Report</a>`);
  });

  it("Signed-in reader can report a work", async () => {
    const cookie = await signIn("x4-signed-in@example.test");
    const res = await fetchW(REPORT, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toContain(`<form method="post" action="${REPORT}">`);
    expect(html).toContain("x4 Work W");
  });

  it("Report form asks for a reason and optional details", async () => {
    const cookie = await signIn("x4-form@example.test");
    const res = await fetchW(REPORT, { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    // A reason, as radio buttons in a labelled group, one of them "This version is wrong".
    expect(html).toMatch(/<fieldset>\s*<legend>Reason<\/legend>/);
    expect(html).toContain(
      '<label><input type="radio" name="reason" value="wrong_version"> This version is wrong</label>',
    );
    expect(html.match(/type="radio" name="reason"/g)?.length).toBeGreaterThan(1);
    // Optional details, labelled.
    expect(html).toContain('<label for="details">Details (optional');
    expect(html).toContain('<textarea id="details" name="details"');
    expect(html).not.toMatch(/<textarea[^>]*required/);
    expect(html).toContain('<button type="submit">');
    // It works with JavaScript off: no script and no anti-spam check.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("cf-turnstile");
    // The strict policy, with a fresh nonce and no frames, and HSTS.
    const csp = res.headers.get("content-security-policy");
    expect(withoutNonce(csp)).toBe(STRICT);
    const again = await fetchW(REPORT, { headers: { cookie } });
    expect(nonceOf(again.headers.get("content-security-policy"))).not.toBe(nonceOf(csp));
    expect(res.headers.get("strict-transport-security")).toMatch(/^max-age=\d+/);
  });

  it("Signed-out reader is sent to sign in before reporting", async () => {
    const res = await fetchW(REPORT);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(TO_SIGN_IN);
    expect(await res.text()).not.toContain("<form");

    // Signing in from there, through the emailed link, comes back to the form.
    const email = "x4-signed-out-get@example.test";
    const login = new URL(res.headers.get("location")!, BASE);
    const form = await (await fetchW(login.pathname + login.search)).text();
    expect(form).toContain(`<input type="hidden" name="next" value="${REPORT}">`);
    const next = login.searchParams.get("next")!;
    const asked = await postLogin({ email, next, "cf-turnstile-response": PASSING_TOKEN });
    expect(asked.status).toBe(200);
    const [sent] = await emailsTo(email);
    const link = new URL(sent!.url);
    const confirmed = await postLogin(
      { token: link.searchParams.get("token")!, next: link.searchParams.get("next")! },
      { url: "/login/confirm" },
    );
    expect(confirmed.status).toBe(303);
    expect(confirmed.headers.get("location")).toBe(`${BASE}${REPORT}`);
  });

  it("Submitting a report stores it and confirms", async () => {
    const email = "x4-submits@example.test";
    const cookie = await signIn(email);
    const res = await postReport(
      { reason: "wrong_version", details: "x4 synthetic details" },
      { cookie },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("<h1>Report sent</h1>");
    expect(html).toContain("A moderator will look at it");
    const [report, ...more] = await reportsBy(email);
    expect(more).toEqual([]);
    // Open, and by U (reportsBy finds it through reporter_id). MOD1's queue and
    // X7's count read `open` and `wrong_version` as stored.
    expect(report!.status).toBe("open");
    expect(report!.kind).toBe("wrong_version");
    expect(report!.body).toBe("x4 synthetic details");
  });

  it("Report without details is accepted", async () => {
    const email = "x4-no-details@example.test";
    const cookie = await signIn(email);
    expect((await postReport({ reason: "other" }, { cookie })).status).toBe(200);
    // Details left empty, or only spaces, store none.
    expect((await postReport({ reason: "other", details: "  \r\n " }, { cookie })).status).toBe(
      200,
    );
    const reports = await reportsBy(email);
    expect(reports).toEqual([
      { kind: "other", body: null, status: "open" },
      { kind: "other", body: null, status: "open" },
    ]);
  });

  it("Banned account cannot report", async () => {
    const email = "x4-banned@example.test";
    const cookie = await signIn(email);
    // Banned after signing in: the session stays valid, the account can't report.
    await db
      .updateTable("user")
      .set({ banned_at: new Date() })
      .where("email", "=", email)
      .execute();
    const res = await postReport({ reason: "other", details: "x4 synthetic details" }, { cookie });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("You can't send reports from this account.");
    expect(await reportsBy(email)).toEqual([]);
    // Nor is it shown the form.
    const form = await fetchW(REPORT, { headers: { cookie } });
    expect(form.status).toBe(403);
    expect(await form.text()).not.toContain("<form");
  });

  it("Signed-out report submission redirects to sign in", async () => {
    const before = await reportCount();
    const res = await postReport({ reason: "other", details: "x4 synthetic details" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(TO_SIGN_IN);
    expect(res.headers.get("strict-transport-security")).toMatch(/^max-age=\d+/);
    expect(await reportCount()).toBe(before);
  });
});
