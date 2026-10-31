// The one-time terms page (ARCHITECTURE, Auth): a signed-in account that hasn't
// accepted the terms is sent to /welcome/terms from every page but a few, and
// accepting there continues to the page it asked for.

import type { MiddlewareHandler } from "hono";
import type { SessionVariables } from "./session";
import { safeNext } from "./signin";

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
 * whatever the method: a GET or HEAD with a 302 carrying the page as `next`, any
 * other with a 303 and no `next`, since a form post is no page to come back to.
 * Runs after the session middleware; signed-out visitors and accepted accounts
 * pass untouched.
 */
export const termsGate: MiddlewareHandler<{ Variables: SessionVariables }> = async (c, next) => {
  const user = c.var.session?.user;
  if (user === undefined || user.termsAcceptedAt != null || isTermsExempt(c.req.path)) {
    return next();
  }
  // Signed in: never cached shared (#108).
  c.header("Cache-Control", "no-store");
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.redirect(WELCOME_TERMS, 303);
  const url = new URL(c.req.url);
  const query = new URLSearchParams({ next: safeNext(url.pathname + url.search) });
  return c.redirect(`${WELCOME_TERMS}?${query.toString()}`, 302);
};
