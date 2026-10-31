import { describe, expect, it } from "vitest";
import { fetchW, STRICT, withoutNonce } from "./helpers";

// Runs in the "open" project: wrangler.jsonc with PRELAUNCH "off", the archive open.

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
