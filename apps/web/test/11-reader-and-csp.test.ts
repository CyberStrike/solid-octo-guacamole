import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://rarepair.fans";
const worker = (exports as any).default as Fetcher;

const fetchW = (input: string, init: RequestInit = {}) =>
  worker.fetch(new URL(input, BASE).toString(), { redirect: "manual", ...init });

// The policies from the scenario's THEN lines, with the nonce left as {n}.
const STRICT =
  "default-src 'self'; script-src 'nonce-{n}' 'strict-dynamic'; style-src 'self'; img-src 'self' https://content.rarepair.fans; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const TURNSTILE = `${STRICT}; frame-src https://challenges.cloudflare.com`;

/** The nonce in a CSP header, or null when there is none. */
const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']*)'/)?.[1] ?? null;

/** The header with its nonce swapped back to {n}, for whole-string comparison. */
const withoutNonce = (csp: string | null) => csp?.replace(/'nonce-[^']*'/, "'nonce-{n}'") ?? null;

describe("11-reader-and-csp", () => {
  it("Every app page sends the strict CSP", async () => {
    // No reader page exists yet, so the not-found page stands in for "any page".
    for (const path of ["/", "/no-such-page", "/login/confirm"]) {
      const res = await fetchW(path);
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      expect(withoutNonce(res.headers.get("content-security-policy"))).toBe(STRICT);
    }
  });
});
