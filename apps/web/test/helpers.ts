import { exports } from "cloudflare:workers";

// Shared by the 22-waitlist tests. (11-reader-and-csp keeps its own copies for now.)

export const BASE = "https://rarepair.fans";
// SAFETY: the default export is the Worker under test, loaded from wrangler.jsonc's main.
const worker = (exports as any).default as Fetcher;

/** A request to the Worker under test, with redirects returned rather than followed. */
export const fetchW = (input: string, init: RequestInit = {}) =>
  worker.fetch(new URL(input, BASE).toString(), { redirect: "manual", ...init });

// The policies from ARCHITECTURE, Reading, with the nonce left as {n}.
export const STRICT =
  "default-src 'self'; script-src 'nonce-{n}' 'strict-dynamic'; style-src 'self'; img-src 'self' https://content.rarepair.fans; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export const TURNSTILE = `${STRICT}; frame-src https://challenges.cloudflare.com`;

/** The nonce in a CSP header, or null when there is none. */
export const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']*)'/)?.[1] ?? null;

/** The header with its nonce swapped back to {n}, for whole-string comparison. */
export const withoutNonce = (csp: string | null) =>
  csp?.replace(/'nonce-[^']*'/, "'nonce-{n}'") ?? null;
