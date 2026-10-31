// The Workers rate-limiting binding's side of the surge controls (ARCHITECTURE, Surge
// controls), shared by every limited route: sign-in now, then uploads, search, removal
// requests and the wait list. Each route passes its own binding and key.

import { tooManyRequestsPage } from "./pages";

/** The sign-in limits' window, as wrangler.jsonc sets it: the binding doesn't say. */
export const LOGIN_WINDOW_SECONDS = 60;

/** A limiter key: a hex SHA-256 of the value under its prefix, so the value itself goes nowhere. */
async function hashKey(prefix: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(prefix + value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The sign-in limit's key for the client a request came from. */
export const loginIpKey = (request: Request) =>
  hashKey("login-ip:", request.headers.get("cf-connecting-ip") ?? "unknown");

/** Whether `key` is over its limit in the current window. */
export async function isLimited(limiter: RateLimit, key: string): Promise<boolean> {
  return !(await limiter.limit({ key })).success;
}

/**
 * The 429 for a limited request: the plain page and `Retry-After`, both saying the same
 * whole number of seconds.
 */
export const tooManyRequests = (seconds: number) =>
  new Response(tooManyRequestsPage(seconds), {
    status: 429,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Retry-After": String(seconds),
      "Cache-Control": "no-store",
    },
  });
