// The Workers rate-limiting binding's side of the surge controls (ARCHITECTURE, Surge
// controls), shared by every limited route: sign-in now, then uploads, search, removal
// requests and the wait list. Each route passes its own binding and key.

import { tooManyRequestsPage } from "./pages";

/** The sign-in limits' window, as wrangler.jsonc sets it: the binding doesn't say. */
export const LOGIN_WINDOW_SECONDS = 60;

/**
 * A limiter key: a hex SHA-256 of the value under its prefix, so the limiter is never handed
 * the address itself. Unkeyed, so not a secret: an IPv4 key can be reversed by trying every
 * address. Fine while keys are never stored or logged.
 */
async function hashKey(prefix: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(prefix + value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Who a client address stands for: an IPv4 address whole, and an IPv6 one by its /64, which
 * one subscriber commonly holds all of, written out in full however it was shortened. An
 * IPv4 address written as IPv6 (`::ffff:198.51.100.7`, or `::ffff:c633:6407`) is that IPv4
 * address.
 */
function clientOf(address: string): string {
  if (!address.includes(":")) return address;
  if (address.includes(".")) return address.slice(address.lastIndexOf(":") + 1);
  const [head = "", tail] = address.toLowerCase().split("::");
  const groups = (part = "") => (part === "" ? [] : part.split(":"));
  const zeros = tail === undefined ? 0 : 8 - groups(head).length - groups(tail).length;
  const all = [...groups(head), ...Array<string>(Math.max(0, zeros)).fill("0"), ...groups(tail)];
  const [high = "", low = ""] = all.slice(6);
  if (all.length === 8 && all.slice(0, 5).every((group) => Number.parseInt(group, 16) === 0)) {
    if (all[5] === "ffff") {
      const value = (Number.parseInt(high, 16) << 16) | Number.parseInt(low, 16);
      return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
    }
  }
  return `${all
    .slice(0, 4)
    .map((group) => group.padStart(4, "0"))
    .join(":")}::/64`;
}

/**
 * A limit's key for a client, from its `cf-connecting-ip` (which Cloudflare sets), or null
 * when the request has none. Requests without one, or with it empty, share a key, so they
 * are limited too. `scope` names the limit ("login"), so two limits' keys never collide even
 * where they share a namespace.
 */
export const ipKey = (scope: string, address: string | null) =>
  hashKey(`${scope}-ip:`, address === null || address === "" ? "unknown" : clientOf(address));

/** A limit's key for an email address, however it was spelt: trimmed and lowercased. */
export const emailKey = (scope: string, address: string) =>
  hashKey(`${scope}-email:`, address.trim().toLowerCase());

/**
 * Whether `key` is over its limit in the current window. When the binding fails the request
 * goes through: the binding's counts are approximate and only meant to slow abuse
 * (ARCHITECTURE, Surge controls), so its outage mustn't take a route down with it. Only the error's name is logged, since the
 * message could carry the key. A binding missing from the config is a mistake, not an
 * outage, so it throws rather than quietly turning the limit off.
 */
export async function isLimited(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (limiter === undefined) throw new Error("Rate limit binding missing");
  try {
    return !(await limiter.limit({ key })).success;
  } catch (error) {
    console.error(`Rate limit unavailable: ${error instanceof Error ? error.name : "Error"}`);
    return false;
  }
}

/**
 * The 429 for a limited request: the plain page and `Retry-After`, both saying the same
 * whole number of seconds, rounded up and at least one.
 */
export function tooManyRequests(seconds: number): Response {
  const wait = Math.max(1, Math.ceil(seconds));
  return new Response(tooManyRequestsPage(wait), {
    status: 429,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Retry-After": String(wait),
      "Cache-Control": "no-store",
    },
  });
}
