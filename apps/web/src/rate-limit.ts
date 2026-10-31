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

/**
 * Who a client address stands for: an IPv4 address whole, and an IPv6 one by its /64, which
 * one subscriber commonly holds all of, written out in full however it was shortened.
 */
function clientOf(address: string): string {
  if (!address.includes(":")) return address;
  const [head = "", tail] = address.toLowerCase().split("::");
  const groups = (part = "") => (part === "" ? [] : part.split(":"));
  const zeros = tail === undefined ? 0 : 8 - groups(head).length - groups(tail).length;
  const all = [...groups(head), ...Array<string>(Math.max(0, zeros)).fill("0"), ...groups(tail)];
  return `${all
    .slice(0, 4)
    .map((group) => group.padStart(4, "0"))
    .join(":")}::/64`;
}

/**
 * The sign-in limit's key for the client a request came from (`cf-connecting-ip`, which
 * Cloudflare sets). Requests without one share a key, so they are limited too.
 */
export const loginIpKey = (request: Request) =>
  hashKey("login-ip:", clientOf(request.headers.get("cf-connecting-ip") ?? "unknown"));

/** The sign-in limit's key for an email address, however it was spelt: trimmed and lowercased. */
export const loginEmailKey = (address: string) =>
  hashKey("login-email:", address.trim().toLowerCase());

/**
 * Whether `key` is over its limit in the current window. When the binding fails the request
 * goes through: every limited form is behind Turnstile too, and the limits are only meant
 * to slow abuse (ARCHITECTURE, Surge controls). Only the error's name is logged, since the
 * message could carry the key.
 */
export async function isLimited(limiter: RateLimit, key: string): Promise<boolean> {
  try {
    return !(await limiter.limit({ key })).success;
  } catch (error) {
    console.error(`Rate limit unavailable: ${error instanceof Error ? error.name : "Error"}`);
    return false;
  }
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
