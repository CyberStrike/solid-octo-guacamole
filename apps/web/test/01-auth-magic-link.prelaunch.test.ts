import { describe, expect, it } from "vitest";
import { BASE, emailsTo, fetchW } from "./helpers";

// Runs in the "prelaunch" project, with PRELAUNCH on as wrangler.jsonc deploys it.
// Sign-in stays open before launch, so an admin can sign in for the first time.
// That /login/confirm and /welcome/terms are open is 22-waitlist.prelaunch's check.

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

    // The link is queued, to the confirm page that stays open.
    const [email] = await emailsTo("prelaunch-admin@example.test");
    const link = new URL(email!.url);
    expect(link.origin + link.pathname).toBe("https://rarepair.fans/login/confirm");
  });
});
