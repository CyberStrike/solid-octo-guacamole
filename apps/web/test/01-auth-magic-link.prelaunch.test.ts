import { describe, expect, it } from "vitest";
import { BASE, fetchW } from "./helpers";

// Runs in the "prelaunch" project: wrangler.jsonc exactly as it deploys, PRELAUNCH on.
// Sign-in stays open before launch, so an admin can sign in for the first time.

describe("01-auth-magic-link before launch", () => {
  it("Sign-in stays open before launch", async () => {
    const page = await fetchW("/login");
    expect(page.status).toBe(200);
    expect(await page.text()).toMatch(/<form\b[^>]*action="\/login"/);

    const res = await fetchW("/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: BASE,
        "sec-fetch-site": "same-origin",
      },
      body: new URLSearchParams({
        email: "prelaunch-admin@example.test",
        "cf-turnstile-response": "XXXX.DUMMY.TOKEN.XXXX",
      }).toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>Check your email</h1>");

    // Not built yet (A2, A4), so 404: but never sent to the coming-soon page.
    for (const path of ["/login/confirm", "/welcome/terms"]) {
      const other = await fetchW(path);
      expect(other.status, path).not.toBe(302);
      expect(other.headers.get("location")).toBeNull();
    }
  });
});
