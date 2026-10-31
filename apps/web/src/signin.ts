// The checks our `POST /login` makes itself, because `auth.api.*` calls skip
// Better Auth's own CSRF and redirect checks (ARCHITECTURE, Auth).

/** The one origin sign-in forms are served from, and the base of every sign-in link. */
export const SITE = "https://rarepair.fans";

/**
 * Reduces a `next` value to a same-site path and query. Anything else, an
 * absent value included, becomes "/": root-relative only, no `//`, no `\`, no
 * control characters.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  // oxlint-disable-next-line no-control-regex -- control characters are what it looks for
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  const url = URL.parse(value, "https://next.invalid");
  if (url === null || url.origin !== "https://next.invalid") return "/";
  // Again after normalization: "/a/..//evil.example" passes the checks above but
  // normalizes to "//evil.example", a protocol-relative URL.
  if (url.pathname.startsWith("//")) return "/";
  return url.pathname + url.search;
}

/**
 * Whether a POST came from a page on the site. Each of `Origin` and
 * `Sec-Fetch-Site` that is present must say so, and at least one must be: same-site
 * isn't enough, since every `*.rarepair.fans` host is same-site with the bare domain.
 */
export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  const site = headers.get("sec-fetch-site");
  if (origin === null && site === null) return false;
  return (origin === null || origin === SITE) && (site === null || site === "same-origin");
}
