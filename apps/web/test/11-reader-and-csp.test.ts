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

  it("Turnstile pages allow only the Turnstile challenge frame", async () => {
    for (const path of ["/login", "/upload", "/remove"]) {
      const res = await fetchW(path);
      const csp = res.headers.get("content-security-policy");
      expect(res.status).toBe(200);
      expect(withoutNonce(csp)).toBe(TURNSTILE);

      const html = await res.text();
      const scripts = html.match(/<script\b[^>]*>/g) ?? [];
      const apiJs = scripts.filter((tag) =>
        tag.includes('src="https://challenges.cloudflare.com/turnstile/v0/api.js"'),
      );
      expect(apiJs).toHaveLength(1);
      expect(apiJs[0]).toContain(`nonce="${nonceOf(csp)}"`);
      for (const tag of scripts) expect(tag).toContain(`nonce="${nonceOf(csp)}"`);
      expect(html).toContain("<noscript>");
    }

    // The allowance is keyed on the exact path, whatever the method.
    const post = await fetchW("/login", { method: "POST" });
    expect(withoutNonce(post.headers.get("content-security-policy"))).toBe(TURNSTILE);
    for (const path of ["/", "/login/confirm", "/loginx", "/upload/new"]) {
      const res = await fetchW(path);
      expect(withoutNonce(res.headers.get("content-security-policy"))).toBe(STRICT);
    }
  });
});
