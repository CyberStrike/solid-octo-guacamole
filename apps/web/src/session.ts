import { createDb } from "@archive/db";
import type { MiddlewareHandler } from "hono";
import { makeAuth } from "./auth";
import type { Bindings } from "./env";

/** A signed-in user and their session, as Better Auth reads them from the cookie. */
export type Session = ReturnType<typeof makeAuth>["$Infer"]["Session"];

export type SessionVariables = { session: Session | null };

/**
 * Reads the session cookie and sets `c.var.session`: the user and their session,
 * or null when signed out. It only reads: a page that needs an account decides
 * what to do without one. Better Auth's default lifetime holds (seven days, extended
 * once a day of use), and an extension comes back as a new cookie, passed on here.
 */
export const sessionMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: SessionVariables;
}> = async (c, next) => {
  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  try {
    const { headers, response } = await makeAuth(c.env, db).api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    c.set("session", response);
    await next();
    // After the handler, as HSTS is: a handler's own Response doesn't keep headers set before it.
    for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
};
