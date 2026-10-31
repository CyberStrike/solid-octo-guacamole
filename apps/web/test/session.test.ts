import { createDb } from "@archive/db";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";
import type { Bindings } from "../src/env";
import { sessionMiddleware, type SessionVariables } from "../src/session";
import { BASE, signIn } from "./helpers";

// The session middleware every page runs behind. It is tested on a probe app of its
// own, without the Worker's terms gate, with the Worker's bindings and a real cookie
// from signing in through the Worker.

const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
afterAll(() => db.destroy());

// Says who the middleware found.
const probe = new Hono<{ Bindings: Bindings; Variables: SessionVariables }>();
probe.use(sessionMiddleware);
probe.get("/", (c) => c.json({ email: c.var.session?.user.email ?? null }));
// A route that sets the session cookie itself, as a sign-out will.
const CLEARED = "__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure";
probe.get("/clear", (c) => {
  c.header("Set-Cookie", CLEARED);
  return c.json({ email: null });
});

/** Asks the probe who is signed in, with `cookie` if given. */
async function whoIs(cookie?: string, path = "/") {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = cookie === undefined ? {} : { cookie };
  const res = await probe.fetch(new Request(`${BASE}${path}`, { headers }), env, ctx);
  await waitOnExecutionContext(ctx);
  // SAFETY: the probe answers with this JSON.
  const { email } = (await res.json()) as { email: string | null };
  return { email, setCookies: res.headers.getSetCookie() };
}

/**
 * Makes `email`'s session two days old. Better Auth extends a session once a day
 * (its default updateAge) of its seven, so the next lookup refreshes it.
 */
async function makeDueForRefresh(email: string) {
  const user = await db
    .selectFrom("user")
    .select("id")
    .where("email", "=", email)
    .executeTakeFirstOrThrow();
  const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60_000);
  await db
    .updateTable("session")
    .set({ expires_at: expiresAt })
    .where("user_id", "=", user.id)
    .execute();
  return { userId: user.id, expiresAt };
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

  it("A route's own session cookie wins over a refresh", async () => {
    const email = "middleware-own-cookie@example.test";
    const cookie = await signIn(email);
    await makeDueForRefresh(email);
    expect((await whoIs(cookie, "/clear")).setCookies).toEqual([CLEARED]);
  });

  it("A session due for refresh is extended, and its cookie set again", async () => {
    const email = "middleware-refresh@example.test";
    const cookie = await signIn(email);
    const { userId, expiresAt } = await makeDueForRefresh(email);

    const { email: found, setCookies } = await whoIs(cookie);
    expect(found).toBe(email);
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toMatch(/^__Secure-better-auth\.session_token=/);
    // The refreshed cookie keeps the attributes ARCHITECTURE fixes, and a fresh seven days.
    const attributes = setCookies[0]!.split(/;\s*/).slice(1);
    expect(attributes.map((a) => a.toLowerCase())).toEqual(
      expect.arrayContaining(["httponly", "secure", "samesite=lax", "path=/", "max-age=604800"]),
    );
    expect(attributes.some((a) => /^domain=/i.test(a))).toBe(false);
    const session = await db
      .selectFrom("session")
      .select("expires_at")
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow();
    expect(session.expires_at.getTime()).toBeGreaterThan(expiresAt.getTime());
  });
});
