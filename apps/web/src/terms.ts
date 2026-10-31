// The one-time terms page (ARCHITECTURE, Auth): a signed-in account that hasn't
// accepted the terms is sent to /welcome/terms from every page but a few, and
// accepting there continues to the page it asked for.

import { createDb } from "@archive/db";
import type { Context, MiddlewareHandler } from "hono";
import type { Bindings } from "./env";
import { readForm } from "./login";
import { forbiddenPage, welcomeTermsPage } from "./pages";
import { redirectCarryingNext, type SessionVariables } from "./session";
import { isSameOrigin, safeNext, SITE } from "./signin";

/** The terms page itself. */
export const WELCOME_TERMS = "/welcome/terms";

/**
 * What an account that hasn't accepted the terms can still reach: the terms page,
 * the terms and privacy pages it links to, sign-in (so it can switch address) and
 * static files. A path ending in `/*` covers everything below it, by whole segment.
 * Sign-out belongs here once a ticket builds it.
 */
export const TERMS_EXEMPT = [
  WELCOME_TERMS,
  "/terms",
  "/privacy",
  "/login",
  "/login/confirm",
  "/assets/*",
] as const;

/** Whether `path` is open to an account that hasn't accepted the terms. */
export const isTermsExempt = (path: string) =>
  TERMS_EXEMPT.some((exempt) =>
    exempt.endsWith("/*") ? path.startsWith(exempt.slice(0, -1)) : path === exempt,
  );

/**
 * Sends a signed-in account whose `terms_accepted_at` is empty to the terms page,
 * whatever the method, as `redirectCarryingNext` does. Runs after the session
 * middleware; signed-out visitors and accepted accounts pass untouched.
 */
export const termsGate: MiddlewareHandler<{ Variables: SessionVariables }> = async (c, next) => {
  const user = c.var.session?.user;
  if (user === undefined || user.termsAcceptedAt != null || isTermsExempt(c.req.path)) {
    return next();
  }
  // Signed in: never cached shared (#108).
  c.header("Cache-Control", "no-store");
  return redirectCarryingNext(c, WELCOME_TERMS);
};

type TermsContext = Context<{ Bindings: Bindings; Variables: SessionVariables }>;

/**
 * Where accepting continues to: `next` reduced to a same-site path, and never the
 * terms page again, which would only send the account on to its own `next`.
 */
function continueTo(next: string | null): string {
  const path = safeNext(next);
  return new URL(path, SITE).pathname === WELCOME_TERMS ? "/" : path;
}

/**
 * `GET /welcome/terms`, after `requireSignIn`: the page to accept the terms, or, once
 * they are accepted, straight on to `next`, so a bookmark never shows it again.
 */
export function showTerms(c: TermsContext) {
  const next = continueTo(c.req.query("next") ?? null);
  c.header("Cache-Control", "no-store");
  if (c.var.session?.user.termsAcceptedAt != null) return c.redirect(next, 302);
  return c.html(welcomeTermsPage(next));
}

/**
 * `POST /welcome/terms`, after `requireSignIn`: sets `terms_accepted_at`, once, and
 * continues to `next` with a 303. As on the sign-in forms, the origin is checked
 * before the body is read, and `next` is reduced whatever the form says.
 */
export async function acceptTerms(c: TermsContext) {
  if (!isSameOrigin(c.req.raw.headers)) return c.html(forbiddenPage(), 403);
  // A body too large to be our form is not read; accepting needs nothing from it.
  const next = (await readForm(c.req.raw))?.get("next") ?? null;
  const user = c.var.session?.user;
  if (user !== undefined && user.termsAcceptedAt == null) {
    const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
    try {
      // Only while still empty: accepting again keeps the first time.
      await db
        .updateTable("user")
        .set({ terms_accepted_at: new Date() })
        .where("id", "=", user.id)
        .where("terms_accepted_at", "is", null)
        .execute();
    } finally {
      c.executionCtx.waitUntil(db.destroy());
    }
  }
  c.header("Cache-Control", "no-store");
  return c.redirect(continueTo(next), 303);
}
