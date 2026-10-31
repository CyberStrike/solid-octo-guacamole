import type { MiddlewareHandler } from "hono";
import type { Bindings } from "./env";

/**
 * Whether the archive is still closed (ARCHITECTURE, Wait list). Only "off" opens it,
 * so a missing or misspelt setting fails closed.
 */
export const isPrelaunch = (env: Pick<Bindings, "PRELAUNCH">) => env.PRELAUNCH !== "off";

// The pages open before launch (ARCHITECTURE, Wait list): the coming-soon page, the
// static pages, sign-in, so an admin can sign in for the first time, and what those
// pages load. Sign-out isn't here: no doc fixes its URL yet.
const OPEN_PATHS = new Set([
  "/",
  "/terms",
  "/privacy",
  "/about",
  "/login",
  "/login/confirm",
  "/welcome/terms",
  "/robots.txt",
  "/favicon.ico",
]);
// Open with everything below them, by whole segment: /admin/launch, never /administrator.
// Not /api/auth: nothing serves it yet, and opening it before launch would be a way
// around POST /login's checks. The ticket that mounts Better Auth's handler adds it.
const OPEN_SECTIONS = ["/waitlist", "/admin", "/assets"];

const isOpenBeforeLaunch = (path: string) =>
  OPEN_PATHS.has(path) ||
  OPEN_SECTIONS.some((section) => path === section || path.startsWith(`${section}/`));

/**
 * Before launch, sends every other app page to the coming-soon page with a 302,
 * whatever the method. Runs after the www redirect, inside HSTS.
 */
export const closedBeforeLaunch: MiddlewareHandler<{
  Bindings: Pick<Bindings, "PRELAUNCH">;
}> = async (c, next) => {
  if (!isPrelaunch(c.env) || isOpenBeforeLaunch(c.req.path)) return next();
  return c.redirect("/", 302);
};
