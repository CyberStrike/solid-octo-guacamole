import { createDb } from "@archive/db";
import { seedWork } from "@archive/db/seed";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, emailsTo, fetchW, PASSING_TOKEN, postLogin } from "./helpers";

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
});
