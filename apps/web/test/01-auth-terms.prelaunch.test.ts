import { describe, expect, it } from "vitest";
import { acceptTerms, fetchW, signIn } from "./helpers";

// Runs in the "prelaunch" project, with PRELAUNCH on as wrangler.jsonc deploys it.
// The terms gate runs after the pre-launch redirect, so a closed page still goes to
// the coming-soon page, and the open ones a new account needs still open.

const get = (path: string, cookie: string) => fetchW(path, { headers: { cookie } });

describe("01-auth-magic-link before launch", () => {
  it("Before launch, a new account can still read and accept the terms", async () => {
    const cookie = await signIn("prelaunch-terms@example.test");

    for (const path of ["/welcome/terms", "/terms", "/privacy"]) {
      expect((await get(path, cookie)).status, path).toBe(200);
    }
    // A closed page goes to the coming-soon page first, as for everyone.
    const closed = await get("/works/13001", cookie);
    expect(closed.status).toBe(302);
    expect(closed.headers.get("location")).toBe("/");
    // An open page that isn't exempt goes to the terms page.
    const about = await get("/about", cookie);
    expect(about.status).toBe(302);
    expect(new URL(about.headers.get("location")!, "https://rarepair.fans").pathname).toBe(
      "/welcome/terms",
    );

    await acceptTerms(cookie);
    expect((await get("/about", cookie)).status).toBe(200);
  });
});
