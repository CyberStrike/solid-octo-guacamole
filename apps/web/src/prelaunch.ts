import type { MiddlewareHandler } from "hono";

/** The web Worker's bindings and vars (wrangler.jsonc). */
export type Bindings = {
  PRELAUNCH?: string;
  TURNSTILE_SITE_KEY: string;
  ASSETS: Fetcher;
};

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
  "/waitlist",
  "/terms",
  "/privacy",
  "/about",
  "/login",
  "/login/confirm",
  "/welcome/terms",
  "/admin",
  "/robots.txt",
  "/favicon.ico",
]);
// Whole path segments: "/admin/" opens /admin/launch, never /administrator.
const OPEN_PREFIXES = ["/waitlist/", "/admin/", "/api/auth/", "/assets/"];

const isOpenBeforeLaunch = (path: string) =>
  OPEN_PATHS.has(path) || OPEN_PREFIXES.some((prefix) => path.startsWith(prefix));

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
