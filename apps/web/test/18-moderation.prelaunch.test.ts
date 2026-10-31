import { createDb } from "@archive/db";
import { env } from "cloudflare:workers";
import { afterAll, describe, expect, it } from "vitest";
import { emailsTo, fetchW, PASSING_TOKEN, postLogin } from "./helpers";

// /admin is open before launch (ARCHITECTURE, Wait list), so the operator can
// moderate then: the gate, not the coming-soon redirect, decides. Text is synthetic.

const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
afterAll(() => db.destroy());

/** Signs `email` in through the Worker as a moderator, and returns its session cookie. */
async function signInModerator(email: string): Promise<string> {
  expect((await postLogin({ email, "cf-turnstile-response": PASSING_TOKEN })).status).toBe(200);
  const [sent] = await emailsTo(email);
  const token = new URL(sent!.url).searchParams.get("token")!;
  const res = await postLogin({ token, next: "/" }, { url: "/login/confirm" });
  expect(res.status).toBe(303);
  await db
    .updateTable("user")
    .set({ role: "moderator", terms_accepted_at: new Date() })
    .where("email", "=", email)
    .execute();
  return res.headers.getSetCookie()[0]!.split(";")[0]!;
}

describe("18 moderation before launch", () => {
  it("A moderator sees the queues before launch", async () => {
    const cookie = await signInModerator("mod1-prelaunch-moderator@example.test");
    const res = await fetchW("/admin/reports", { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it("A signed-out visitor gets 404 before launch, not the coming-soon redirect", async () => {
    const res = await fetchW("/admin/reports");
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });
});
