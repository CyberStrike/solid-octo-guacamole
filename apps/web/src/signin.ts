// The checks our `POST /login` and `POST /login/confirm` make themselves, because
// `auth.api.*` calls skip Better Auth's own CSRF and redirect checks (ARCHITECTURE,
// Auth). `POST /waitlist` uses the origin check too.

/** The one origin sign-in forms are served from, and the base of every sign-in link. */
export const SITE = "https://rarepair.fans";

// The longest `next` kept, in characters as normalized and percent-encoded.
const MAX_NEXT = 512;

/** How long a sign-in link works (ARCHITECTURE, Auth). The pages say it too. */
export const LINK_LIFETIME_MINUTES = 15;

/**
 * Reduces a `next` value to a same-site path and query. Anything else, an
 * absent value included, becomes "/": root-relative only, no `//`, no `\`, no
 * control characters.
 */
export function safeNext(value: string | null): string {
  if (value === null || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return "/";
  // oxlint-disable-next-line no-control-regex -- control characters are what it looks for
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  const url = URL.parse(value, "https://next.invalid");
  if (url === null || url.origin !== "https://next.invalid") return "/";
  // Again after normalization: "/a/..//evil.example" passes the checks above but
  // normalizes to "//evil.example", a protocol-relative URL.
  if (url.pathname.startsWith("//")) return "/";
  const path = url.pathname + url.search;
  // The sign-in link carries it encoded again, and the mailer drops a link over
  // 2048 characters: up to three times this, plus the token, still fits.
  return path.length > MAX_NEXT ? "/" : path;
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
