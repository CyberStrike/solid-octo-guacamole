import { createDb } from "@archive/db";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";
import type { Bindings } from "../src/env";
import { sessionMiddleware, type SessionVariables } from "../src/session";
import { BASE, emailsTo, fetchW, PASSING_TOKEN, postLogin } from "./helpers";

// The session middleware later pages use. No route of the Worker uses it yet, so it
// is tested on a probe app of its own, with the Worker's bindings and a real cookie
// from signing in through the Worker.

const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
afterAll(() => db.destroy());

// Says who the middleware found.
const probe = new Hono<{ Bindings: Bindings; Variables: SessionVariables }>();
probe.use(sessionMiddleware);
probe.get("/", (c) => c.json({ email: c.var.session?.user.email ?? null }));

/** Asks the probe who is signed in, with `cookie` if given. */
async function whoIs(cookie?: string) {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = cookie === undefined ? {} : { cookie };
  const res = await probe.fetch(new Request(`${BASE}/`, { headers }), env, ctx);
  await waitOnExecutionContext(ctx);
  // SAFETY: the probe answers with this JSON.
  const { email } = (await res.json()) as { email: string | null };
  return { email, setCookies: res.headers.getSetCookie() };
}

/** Signs `email` in through the Worker, and returns the `name=value` of its session cookie. */
async function signIn(email: string): Promise<string> {
  expect((await postLogin({ email, "cf-turnstile-response": PASSING_TOKEN })).status).toBe(200);
  const [sent] = await emailsTo(email);
  const token = new URL(sent!.url).searchParams.get("token")!;
  const res = await fetchW("/login/confirm", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: BASE,
      "sec-fetch-site": "same-origin",
    },
    body: new URLSearchParams({ token, next: "/" }).toString(),
  });
  expect(res.status).toBe(303);
  return res.headers.getSetCookie()[0]!.split(";")[0]!;
}

describe("session middleware", () => {
  it("A signed-in cookie gives the session", async () => {
    const email = "middleware-signed-in@example.test";
    const cookie = await signIn(email);
    const { email: found, setCookies } = await whoIs(cookie);
    expect(found).toBe(email);
    // A fresh session needs no refresh, so nothing is set.
    expect(setCookies).toEqual([]);
  });

  it("No cookie, or a forged one, gives no session", async () => {
    expect((await whoIs()).email).toBeNull();
    expect((await whoIs("__Secure-better-auth.session_token=forged.value")).email).toBeNull();
  });

  it("A session due for refresh is extended, and its cookie set again", async () => {
    const email = "middleware-refresh@example.test";
    const cookie = await signIn(email);
    // Better Auth extends a session once a day (its default updateAge) of its seven:
    // make this one two days old.
    const user = await db
      .selectFrom("user")
      .select("id")
      .where("email", "=", email)
      .executeTakeFirstOrThrow();
    const fiveDays = new Date(Date.now() + 5 * 24 * 60 * 60_000);
    await db
      .updateTable("session")
      .set({ expires_at: fiveDays })
      .where("user_id", "=", user.id)
      .execute();

    const { email: found, setCookies } = await whoIs(cookie);
    expect(found).toBe(email);
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toMatch(/^__Secure-better-auth\.session_token=/);
    expect(setCookies[0]).toMatch(/;\s*max-age=604800/i);
    const session = await db
      .selectFrom("session")
      .select("expires_at")
      .where("user_id", "=", user.id)
      .executeTakeFirstOrThrow();
    expect(session.expires_at.getTime()).toBeGreaterThan(fiveDays.getTime());
  });
});
