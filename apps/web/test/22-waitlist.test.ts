import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// Runs in the "open" project: wrangler.jsonc with PRELAUNCH "off", the archive open.

const BASE = "https://rarepair.fans";
// SAFETY: the default export is the Worker under test, loaded from wrangler.jsonc's main.
const worker = (exports as any).default as Fetcher;

const fetchW = (input: string, init: RequestInit = {}) =>
  worker.fetch(new URL(input, BASE).toString(), { redirect: "manual", ...init });

// ARCHITECTURE, Reading: the strict policy, with the nonce left as {n}.
const STRICT =
  "default-src 'self'; script-src 'nonce-{n}' 'strict-dynamic'; style-src 'self'; img-src 'self' https://content.rarepair.fans; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/** The header with its nonce swapped back to {n}, for whole-string comparison. */
const withoutNonce = (csp: string | null) => csp?.replace(/'nonce-[^']*'/, "'nonce-{n}'") ?? null;

describe("22-waitlist", () => {
  it("With PRELAUNCH off, / gets no frame-src allowance and no page redirects", async () => {
    // No home page exists yet, so / is the not-found page, with the strict policy only.
    const home = await fetchW("/");
    expect(home.status).toBe(404);
    expect(withoutNonce(home.headers.get("content-security-policy"))).toBe(STRICT);
    expect(await home.text()).not.toMatch(/cf-turnstile|wait list|woff2/i);

    // Pages that redirect before launch are served as they are.
    const pages: [string, number][] = [
      ["/upload", 200],
      ["/remove", 200],
      ["/no-such-page", 404],
      ["/works/1/chapters/2", 404],
      ["/administrator", 404],
    ];
    for (const [path, status] of pages) {
      const res = await fetchW(path);
      expect(res.status, path).toBe(status);
      expect(res.headers.get("location")).toBeNull();
      // And none of them loads a web font.
      expect(await res.text()).not.toMatch(/\/assets\/waitlist\/|woff2|@font-face/);
    }
  });
});
