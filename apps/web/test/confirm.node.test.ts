import { describe, expect, it } from "vitest";
import { answerVerified } from "../src/confirm";

// What POST /login/confirm makes of Better Auth's verify response. The server
// faults can't be caused through the Worker's fetch, so the answers are shown here
// on responses shaped as Better Auth 1.7.14's magicLinkVerify returns them.

const COOKIE =
  "__Secure-better-auth.session_token=abc.def; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax";

const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
};

describe("answerVerified", () => {
  it("A sign-in becomes a 303 to the same place, with its cookie", () => {
    const res = answerVerified(redirect("https://rarepair.fans/works/1", [COOKIE]));
    expect(res?.status).toBe(303);
    expect(res?.headers.get("location")).toBe("https://rarepair.fans/works/1");
    expect(res?.headers.getSetCookie()).toEqual([COOKIE]);
  });

  it("A used, expired or unknown link goes to /login with our code alone", () => {
    const res = answerVerified(
      redirect("https://rarepair.fans/login?error=INVALID_TOKEN&error_description=anything"),
    );
    expect(res?.status).toBe(303);
    expect(res?.headers.get("location")).toBe("/login?error=INVALID_TOKEN");
    expect(res?.headers.getSetCookie()).toEqual([]);
  });

  it("A server fault is not the link's: no answer, so the route gives a 500", () => {
    for (const code of ["failed_to_create_user", "failed_to_create_session", "user_not_found"]) {
      expect(
        answerVerified(redirect(`https://rarepair.fans/login?error=${code}`)),
        code,
      ).toBeNull();
    }
    // Anything but a redirect, such as Better Auth's JSON answer.
    expect(answerVerified(Response.json({ token: "x" }))).toBeNull();
  });
});
