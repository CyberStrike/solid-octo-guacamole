import { createDb } from "@archive/db";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { makeAuth, SESSION_COOKIE } from "./auth";
import type { Bindings } from "./env";
import { safeNext } from "./signin";

/** A signed-in user and their session, as Better Auth reads them from the cookie. */
export type Session = ReturnType<typeof makeAuth>["$Infer"]["Session"];

export type SessionVariables = { session: Session | null };

/**
 * Reads the session cookie and sets `c.var.session`: the user and their session,
 * or null when signed out. It never redirects or refuses: a page that needs an
 * account decides what to do without one. Better Auth's default lifetime holds
 * (seven days, extended once a day of use). The lookup can write: an extension
 * updates the session row and comes back as a new cookie, passed on here, and an
 * expired session's row is deleted.
 */
export const sessionMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: SessionVariables;
}> = async (c, next) => {
  // Signed out: no cookie, so nothing to look up.
  if (getCookie(c, SESSION_COOKIE) === undefined) {
    c.set("session", null);
    return next();
  }
  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  try {
    const { headers, response } = await makeAuth(c.env, db).api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    c.set("session", response);
    await next();
    // After the handler, as HSTS is: a handler's own Response doesn't keep headers
    // set before it. A route that set the session cookie itself, such as a
    // sign-out, has the last word: a refresh after it would undo it.
    const isSession = (cookie: string) => cookie.startsWith(`${SESSION_COOKIE}=`);
    const own = c.res.headers.getSetCookie().some(isSession);
    for (const cookie of headers.getSetCookie()) {
      if (own && isSession(cookie)) continue;
      c.header("Set-Cookie", cookie, { append: true });
    }
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
};

/**
 * For a route that needs an account, after `sessionMiddleware`. Signed out, a GET
 * or HEAD is sent to sign in with a 302, carrying the page as `next`; any other
 * method gets a 303 to `/login` with no `next`, since a form post is no page to
 * come back to. A route that must answer a script with 401 instead checks
 * `c.var.session` itself.
 */
export const requireSignIn: MiddlewareHandler<{ Variables: SessionVariables }> = async (
  c,
  next,
) => {
  if (c.var.session != null) return next();
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.redirect("/login", 303);
  const url = new URL(c.req.url);
  const query = new URLSearchParams({ next: safeNext(url.pathname + url.search) });
  return c.redirect(`/login?${query.toString()}`, 302);
};
