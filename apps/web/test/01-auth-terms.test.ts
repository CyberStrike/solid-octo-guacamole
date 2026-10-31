import { createDb } from "@archive/db";
import { seedWork } from "@archive/db/seed";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, emailsTo, fetchW, PASSING_TOKEN, postLogin, signIn } from "./helpers";

// The terms gate (A4): a signed-in account that hasn't accepted the terms is sent to
// /welcome/terms first. One database serves every test file in the run, so this file
// keeps to AO3 work IDs 13000 to 13099 and finds its rows by address.

const WORK = 13000;
const WORK_PAGE = `/works/${WORK}`;

const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });

beforeAll(async () => {
  await seedWork(db, { ao3WorkId: WORK, title: "a4 Work" });
});
afterAll(() => db.destroy());

/** A request to the Worker with `cookie`, a GET unless `method` says otherwise. */
const get = (path: string, cookie: string, method = "GET") =>
  fetchW(path, { method, headers: { cookie } });

/** Where a redirect goes, as a URL on the site. */
const locationOf = (res: Response) => new URL(res.headers.get("location") ?? "", BASE);

/** Shows `res` sends the account to the terms page, to come back to `next`. */
function expectTermsRedirect(res: Response, next: string) {
  expect(res.status).toBe(302);
  const location = locationOf(res);
  expect(location.origin).toBe(BASE);
  expect(location.pathname).toBe("/welcome/terms");
  expect(location.searchParams.get("next")).toBe(next);
}

describe("01-auth-magic-link", () => {
  it("New account must accept the terms before continuing", async () => {
    const cookie = await signIn("terms-new@example.test", { next: WORK_PAGE });

    expectTermsRedirect(await get(WORK_PAGE, cookie), WORK_PAGE);
  });

  it("Before accepting, every other page and method goes to the terms page", async () => {
    const cookie = await signIn("terms-every-page@example.test");

    for (const path of [
      "/",
      "/upload",
      "/remove",
      "/about",
      "/admin",
      "/nope",
      "/works/13000?x=1",
    ]) {
      const res = await get(path, cookie);
      expectTermsRedirect(res, path);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("strict-transport-security")).toMatch(/max-age=/);
    }
    expectTermsRedirect(await get(WORK_PAGE, cookie, "HEAD"), WORK_PAGE);
    // A form post is no page to come back to.
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await get("/waitlist", cookie, method);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/welcome/terms");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("Before accepting, the terms, privacy and sign-in pages and static files still open", async () => {
    const cookie = await signIn("terms-exempt@example.test");

    for (const path of ["/terms", "/privacy", "/login", "/login/confirm?token=x"]) {
      const res = await get(path, cookie);
      expect(res.status, path).toBe(200);
    }
    // The stylesheet every page links to, the terms page's own included.
    const page = await (await get("/terms", cookie)).text();
    const stylesheet = page.match(/<link rel="stylesheet" href="([^"]+)"/)![1]!;
    const css = await get(stylesheet, cookie);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toMatch(/^text\/css/);
  });

  it("A signed-out visitor, or a forged cookie, is never sent to the terms page", async () => {
    for (const path of ["/about", "/terms", WORK_PAGE]) {
      expect((await fetchW(path)).status, path).toBe(200);
      const forged = await get(path, "__Secure-better-auth.session_token=forged.value");
      expect(forged.status, path).toBe(200);
    }
  });

  it("Returning user skips the terms page", async () => {
    const email = "terms-returning@example.test";
    await signIn(email);
    // An existing account, its terms accepted some time ago.
    await db
      .updateTable("user")
      .set({ terms_accepted_at: new Date("2026-09-01T00:00:00Z") })
      .where("email", "=", email)
      .execute();

    // Signing in again through a new emailed link, from the work page.
    expect((await postLogin({ email, "cf-turnstile-response": PASSING_TOKEN })).status).toBe(200);
    const sent = await emailsTo(email, { atLeast: 2 });
    const token = new URL(sent.at(-1)!.url).searchParams.get("token")!;
    const confirmed = await postLogin({ token, next: WORK_PAGE }, { url: "/login/confirm" });
    expect(confirmed.status).toBe(303);
    expect(locationOf(confirmed).href).toBe(`${BASE}${WORK_PAGE}`);

    const cookie = confirmed.headers.getSetCookie()[0]!.split(";")[0]!;
    const page = await get(WORK_PAGE, cookie);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("a4 Work");
  });
});
