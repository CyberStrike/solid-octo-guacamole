import { createDb } from "@archive/db";
import { env } from "cloudflare:workers";
import { afterAll, describe, expect, it } from "vitest";
import {
  emailsTo,
  fetchW,
  nonceOf,
  PASSING_TOKEN,
  postLogin,
  TURNSTILE,
  withoutNonce,
} from "./helpers";

// U1's cases: the upload page and `POST /uploads`, which hands out a presigned PUT URL.
// That R2 refuses a PUT with another content type, or after 10 minutes, is shown on the
// URL's signature in presign.node.test.ts: Miniflare's R2 has no S3 endpoint to PUT to.

// One database serves every test file of a project, so each test signs in its own user
// and finds rows by that user.
const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
afterAll(() => db.destroy());

// vitest.config.ts's throwaway R2 account id, as the presigned URL's host names it.
const S3_HOST = "test0000000000000000000000000acct.r2.cloudflarestorage.com";

/**
 * Signs `email` in through the Worker, with the terms accepted, and returns the user's id
 * and the `name=value` of the session cookie.
 */
async function signIn(email: string): Promise<{ userId: string; cookie: string }> {
  expect((await postLogin({ email, "cf-turnstile-response": PASSING_TOKEN })).status).toBe(200);
  const [sent] = await emailsTo(email);
  const token = new URL(sent!.url).searchParams.get("token")!;
  const res = await postLogin({ token, next: "/upload" }, { url: "/login/confirm" });
  expect(res.status).toBe(303);
  const user = await db
    .updateTable("user")
    .set({ terms_accepted_at: new Date() })
    .where("email", "=", email)
    .returning("id")
    .executeTakeFirstOrThrow();
  return { userId: user.id, cookie: res.headers.getSetCookie()[0]!.split(";")[0]! };
}

/** The upload page's script asking for a URL, as a browser on rarepair.fans sends it. */
const requestUpload = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
  postLogin(fields, { url: "/uploads", headers });

const uploadsOf = (userId: string) =>
  db
    .selectFrom("uploads")
    .select(["id", "r2_key", "bytes", "status", "sha256"])
    .where("user_id", "=", userId)
    .execute();

type Reply = { id?: string; url?: string; error?: string };

/** The JSON reply of a refused request: an error to show, and nothing else. */
async function expectRefused(res: Response, status: number) {
  expect(res.status).toBe(status);
  expect(res.headers.get("location")).toBeNull();
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  // SAFETY: POST /uploads answers JSON.
  const body = (await res.json()) as Reply;
  expect(body.url).toBeUndefined();
  expect(body.id).toBeUndefined();
  expect(body.error).toEqual(expect.any(String));
  return body.error!;
}

describe("01-auth-magic-link", () => {
  it("Uploading needs an account", async () => {
    const page = await fetchW("/upload");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/login?next=%2Fupload");

    const res = await requestUpload({ size: "1000", "cf-turnstile-response": PASSING_TOKEN });
    await expectRefused(res, 401);
  });
});

describe("02-upload-handshake", () => {
  it("Upload request returns a presigned PUT URL", async () => {
    const { userId, cookie } = await signIn("u1-presigned@example.test");
    const res = await requestUpload(
      { size: "123456", "cf-turnstile-response": PASSING_TOKEN },
      { cookie },
    );
    expect(res.status).toBe(200);
    // SAFETY: POST /uploads answers JSON.
    const { id, url } = (await res.json()) as Reply;

    expect(await uploadsOf(userId)).toEqual([
      { id, r2_key: `uploads/${id}`, bytes: 123456, status: "pending", sha256: null },
    ]);

    const put = new URL(url!);
    expect(put.origin).toBe(`https://${S3_HOST}`);
    expect(put.pathname).toBe(`/rarepair/uploads/${id}`);
    expect(put.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(put.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(put.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Declared size of exactly 25 MB is accepted", async () => {
    const { userId, cookie } = await signIn("u1-exactly-25@example.test");
    const res = await requestUpload(
      { size: "26214400", "cf-turnstile-response": PASSING_TOKEN },
      { cookie },
    );
    expect(res.status).toBe(200);
    // SAFETY: POST /uploads answers JSON.
    const { url } = (await res.json()) as Reply;
    expect(new URL(url!).origin).toBe(`https://${S3_HOST}`);
    expect((await uploadsOf(userId)).map((row) => row.bytes)).toEqual([26214400]);
  });

  it("Declared size over 25 MB is refused", async () => {
    const { userId, cookie } = await signIn("u1-over-25@example.test");
    const res = await requestUpload(
      { size: "26214401", "cf-turnstile-response": PASSING_TOKEN },
      { cookie },
    );
    expect(await expectRefused(res, 413)).toMatch(/over the 25 MB limit/);
    expect(await uploadsOf(userId)).toEqual([]);
  });

  it("Upload request without a session is refused", async () => {
    const res = await requestUpload({ size: "1000", "cf-turnstile-response": PASSING_TOKEN });
    await expectRefused(res, 401);
    // A cookie that names no session is no session.
    const forged = await requestUpload(
      { size: "1000", "cf-turnstile-response": PASSING_TOKEN },
      { cookie: "__Secure-better-auth.session_token=forged.value" },
    );
    await expectRefused(forged, 401);
  });

  it("Upload request without Turnstile is refused", async () => {
    const { userId, cookie } = await signIn("u1-no-turnstile@example.test");
    const missingOrFailing: Record<string, string>[] = [
      { size: "1000" },
      { size: "1000", "cf-turnstile-response": "bad" },
    ];
    for (const fields of missingOrFailing) {
      const res = await requestUpload(fields, { cookie });
      expect(await expectRefused(res, 400)).toMatch(/anti-spam check/);
    }
    // Turnstile not answering is not the uploader's fault.
    const down = await requestUpload(
      { size: "1000", "cf-turnstile-response": "siteverify-down" },
      { cookie },
    );
    await expectRefused(down, 503);
    expect(await uploadsOf(userId)).toEqual([]);
  });

  it("A declared size that is not a positive whole number is refused", async () => {
    const { userId, cookie } = await signIn("u1-bad-size@example.test");
    for (const size of [undefined, "", "abc", "-1", "0", "1.5", "1e3", " 12", "0x10"]) {
      const token = { "cf-turnstile-response": PASSING_TOKEN };
      const res = await requestUpload(size === undefined ? token : { ...token, size }, { cookie });
      await expectRefused(res, 400);
    }
    expect(await uploadsOf(userId)).toEqual([]);
  });

  it("An upload request from another site is refused", async () => {
    const { userId, cookie } = await signIn("u1-cross-site@example.test");
    const fields = { size: "1000", "cf-turnstile-response": PASSING_TOKEN };
    for (const headers of [
      { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      { origin: "https://www.rarepair.fans", "sec-fetch-site": "same-site" },
    ]) {
      const res = await requestUpload(fields, { cookie, ...headers });
      expect(res.status).toBe(403);
    }
    expect(await uploadsOf(userId)).toEqual([]);
  });

  it("Upload page without JavaScript explains it is needed", async () => {
    const { cookie } = await signIn("u1-noscript@example.test");
    const res = await fetchW("/upload", { headers: { cookie } });
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy");
    expect(withoutNonce(csp)).toBe(TURNSTILE);

    const html = await res.text();
    const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? "";
    expect(noscript).toMatch(/Uploading needs JavaScript/);
    // Nothing on the page can send a file without the script: no form posts anywhere.
    expect(html).not.toMatch(/<form\b[^>]*\baction=/i);
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="\.epub,application\/epub\+zip"/);
    expect(html).toContain('<div class="cf-turnstile" data-sitekey="1x00000000000000000000AA">');
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonceOf(csp)}"`);
  });

  it("The upload page has the site's chrome", async () => {
    // What 20-site-chrome checks on pages anyone can open.
    const { cookie } = await signIn("u1-chrome@example.test");
    const html = await (await fetchW("/upload", { headers: { cookie } })).text();
    expect(html.match(/<[a-z]+ class="banner"[^>]*>/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<a href="/remove">Remove my work</a>');
    expect(html).not.toMatch(/AO3|OTW|Archive of Our Own|woff2|@font-face/i);
  });
});

describe("19-surge-controls-and-quotas", () => {
  it("Turnstile guards upload requests", async () => {
    const { userId, cookie } = await signIn("u1-surge-turnstile@example.test");
    const res = await requestUpload({ size: "1000", "cf-turnstile-response": "bad" }, { cookie });
    expect(await expectRefused(res, 400)).toMatch(/anti-spam check did not pass/);
    expect(await uploadsOf(userId)).toEqual([]);
  });
});
