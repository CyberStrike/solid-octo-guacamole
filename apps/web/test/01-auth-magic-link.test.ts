import { createDb } from "@archive/db";
import { env, exports } from "cloudflare:workers";
import { afterAll, describe, expect, it } from "vitest";
import { parseMessage, type EmailMessage } from "../../mailer/src/message";

const BASE = "https://rarepair.fans";
// SAFETY: the default export is the Worker under test, loaded from wrangler.jsonc's main.
const worker = (exports as any).default as Fetcher;

const fetchW = (input: string, init: RequestInit = {}) =>
  worker.fetch(new URL(input, BASE).toString(), { redirect: "manual", ...init });

/** The nonce in a CSP header, or null when there is none. */
const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']*)'/)?.[1] ?? null;

/** The opening tag of the sign-in form, or null. */
const formTag = (html: string) => html.match(/<form\b[^>]*action="\/login"[^>]*>/)?.[0] ?? null;

// The token vitest.config.ts's siteverify stand-in passes, as Cloudflare's test secret does.
const PASSING_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/** The sign-in form as a browser on rarepair.fans submits it. */
function postLogin(
  fields: Record<string, string>,
  {
    url = "/login",
    headers = {},
    body = new URLSearchParams(fields).toString(),
  }: { url?: string; headers?: Record<string, string>; body?: BodyInit } = {},
) {
  return fetchW(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: BASE,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body,
  });
}

// The Postgres the Worker uses, through the same Hyperdrive binding. One database
// serves every test file, so each test uses its own email address.
const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
afterAll(() => db.destroy());

const verificationIds = async () =>
  new Set((await db.selectFrom("verification").select("id").execute()).map((r) => r.id));

/** Every message the `email` queue has delivered so far, from the test's sink. */
async function deliveredEmails(): Promise<unknown[]> {
  // SAFETY: the sink answers with the JSON array of message bodies it was delivered.
  return (await (await env.EMAIL_SINK.fetch("https://email-sink/")).json()) as unknown[];
}

/** Waits for the queue to deliver a message to `to`, and returns every one it has. */
async function emailsTo(to: string, { atLeast = 1 } = {}) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const mine = (await deliveredEmails())
      .map(parseMessage)
      .filter((email): email is EmailMessage => email?.to === to);
    if (mine.length >= atLeast || Date.now() > deadline) return mine;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// 254 characters: a 64-character local part and labels of at most 63.
const LONGEST_EMAIL = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(56)}.test`;

let sentinels = 0;

/**
 * Whether anything was queued for `to`. The queue delivers in order, one message
 * a batch, so once a later request's email has arrived, an earlier one's would have.
 */
async function queuedFor(to: string): Promise<boolean> {
  const sentinel = `sentinel-${++sentinels}@example.test`;
  const res = await postLogin({ email: sentinel, "cf-turnstile-response": PASSING_TOKEN });
  expect(res.status).toBe(200);
  expect(await emailsTo(sentinel)).toHaveLength(1);
  // Any body addressed to `to`, even one the mailer would refuse.
  const field = `"to":${JSON.stringify(to)}`;
  return (await deliveredEmails()).some((body) => JSON.stringify(body).includes(field));
}

/** Shows that a refused request left nothing behind: no token and no email. */
async function expectNothingCreated(to: string, before: Set<string>) {
  expect(await verificationIds()).toEqual(before);
  expect(await queuedFor(to)).toBe(false);
}

describe("01-auth-magic-link", () => {
  it("Sign-in page shows an email form", async () => {
    const res = await fetchW("/login?next=%2Fworks%2F1");
    expect(res.status).toBe(200);
    const nonce = nonceOf(res.headers.get("content-security-policy"));
    const html = await res.text();

    const form = formTag(html);
    expect(form).toContain('method="post"');
    expect(html).toMatch(/<input\b[^>]*type="email"[^>]*name="email"[^>]*required/);
    // The page it was opened from comes back after sign-in.
    expect(html).toMatch(/<input\b[^>]*type="hidden"[^>]*name="next"[^>]*value="\/works\/1"/);
    // Turnstile alongside: the widget, with the site key from wrangler.jsonc, and its script.
    expect(html).toContain('<div class="cf-turnstile" data-sitekey="1x00000000000000000000AA">');
    expect(html).toContain(
      `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" nonce="${nonce}"`,
    );
  });

  it("Sign-in page without JavaScript explains it is needed", async () => {
    const res = await fetchW("/login");
    const nonce = nonceOf(res.headers.get("content-security-policy"));
    const html = await res.text();

    expect(html).toMatch(/<noscript>[^]*Signing in needs JavaScript[^]*<\/noscript>/);
    // Without JavaScript nothing can be submitted: the only form is hidden, and only a
    // script, nonced for this page, shows it.
    expect(html.match(/<form\b[^>]*>/g)).toEqual([formTag(html)]);
    expect(formTag(html)).toMatch(/\shidden[\s>]/);
    expect(html).toContain(
      `<script nonce="${nonce}">document.getElementById("sign-in").hidden = false;</script>`,
    );
  });

  it("Requesting a magic link queues an email with a single-use token", async () => {
    const before = await verificationIds();
    const res = await postLogin({
      email: "queued@example.test",
      next: "/works/1",
      "cf-turnstile-response": PASSING_TOKEN,
    });
    expect(res.status).toBe(200);

    // One email, in the shape apps/mailer accepts, linking to /login/confirm with a token.
    const [email, ...more] = await emailsTo("queued@example.test");
    expect(more).toEqual([]);
    expect(email).toMatchObject({ kind: "sign-in", to: "queued@example.test" });
    const link = new URL(email!.url);
    expect(link.origin + link.pathname).toBe("https://rarepair.fans/login/confirm");
    const token = link.searchParams.get("token");
    expect(token).toMatch(/^\S{16,}$/);
    expect(link.searchParams.get("next")).toBe("/works/1");

    // Only a hash of it is stored, and it is valid for 15 minutes.
    const rows = (
      await db
        .selectFrom("verification")
        .select(["id", "identifier", "value", "expires_at"])
        .execute()
    ).filter((row) => !before.has(row.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.identifier).not.toContain(token);
    expect(rows[0]!.value).not.toContain(token);
    const lifetime = rows[0]!.expires_at.getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(14 * 60_000);
    expect(lifetime).toBeLessThanOrEqual(15 * 60_000);

    // Whatever host the request came in on, the link is to rarepair.fans.
    const elsewhere = await postLogin(
      {
        email: "queued-elsewhere@example.test",
        "cf-turnstile-response": `${PASSING_TOKEN}@web.internal.example`,
      },
      { url: "https://web.internal.example/login" },
    );
    expect(elsewhere.status).toBe(200);
    const [other] = await emailsTo("queued-elsewhere@example.test");
    expect(new URL(other!.url).origin).toBe("https://rarepair.fans");
  });

  it("Check-your-email page sets expectations", async () => {
    const res = await postLogin({
      email: "expectations@example.test",
      "cf-turnstile-response": PASSING_TOKEN,
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Check your email</h1>");
    expect(html).toContain("It lasts 15 minutes.");
    expect(html).toContain("The link can take a minute to arrive during busy periods.");
  });

  it("Login request without Turnstile is refused", async () => {
    const cases: [string, Record<string, string>][] = [
      ["no-turnstile@example.test", {}],
      ["empty-turnstile@example.test", { "cf-turnstile-response": "" }],
      ["failing-turnstile@example.test", { "cf-turnstile-response": "a-failing-token" }],
      // Solved, but for another host than the one the form was posted to.
      [
        "other-host-turnstile@example.test",
        { "cf-turnstile-response": `${PASSING_TOKEN}@evil.example` },
      ],
    ];
    for (const [email, turnstile] of cases) {
      const before = await verificationIds();
      const res = await postLogin({ email, next: "/works/1", ...turnstile });

      expect(res.status).toBe(400);
      const html = await res.text();
      // The form again, with an error, keeping what was typed and where to go back to.
      expect(formTag(html)).not.toBeNull();
      expect(html).toContain(
        '<p role="alert">The anti-spam check did not pass. Please try again.</p>',
      );
      expect(html).toContain(`value="${email}"`);
      expect(html).toMatch(/name="next" value="\/works\/1"/);
      await expectNothingCreated(email, before);
    }
  });

  it("Cross-site login request is refused", async () => {
    const cases: [string, Record<string, string>][] = [
      ["evil-origin@example.test", { origin: "https://evil.example" }],
      ["content-origin@example.test", { origin: "https://content.rarepair.fans" }],
      ["same-site@example.test", { "sec-fetch-site": "same-site" }],
      ["cross-site@example.test", { "sec-fetch-site": "cross-site" }],
    ];
    for (const [email, headers] of cases) {
      const before = await verificationIds();
      const res = await postLogin({ email, "cf-turnstile-response": PASSING_TOKEN }, { headers });
      expect(res.status).toBe(403);
      await expectNothingCreated(email, before);
    }

    // Neither header at all (the brief's ruling): refused too.
    const before = await verificationIds();
    const bare = await fetchW("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "no-headers@example.test",
        "cf-turnstile-response": PASSING_TOKEN,
      }).toString(),
    });
    expect(bare.status).toBe(403);
    await expectNothingCreated("no-headers@example.test", before);
  });

  it("An oversized sign-in request is refused before it is read", async () => {
    // A form body of exactly `bytes` bytes, passing Turnstile.
    const prefix = `email=oversized%40example.test&cf-turnstile-response=${PASSING_TOKEN}&padding=`;
    const formOf = (bytes: number) => prefix + "x".repeat(bytes - prefix.length);
    // The same, as a stream of unknown length, so no Content-Length is sent.
    const streamOf = (text: string) => {
      const bytes = new TextEncoder().encode(text);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          for (let at = 0; at < bytes.length; at += 1000) {
            controller.enqueue(bytes.slice(at, at + 1000));
          }
          controller.close();
        },
      });
    };

    const before = await verificationIds();
    for (const body of [formOf(16 * 1024 + 1), streamOf(formOf(16 * 1024 + 1))]) {
      const res = await postLogin({}, { body });
      expect(res.status).toBe(413);
      const html = await res.text();
      expect(formTag(html)).not.toBeNull();
      expect(html).not.toContain("oversized");
      expect(html).not.toContain("x".repeat(100));
    }
    await expectNothingCreated("oversized@example.test", before);

    // 16 KB exactly is read, either way.
    for (const body of [formOf(16 * 1024), streamOf(formOf(16 * 1024))]) {
      expect((await postLogin({}, { body })).status).toBe(200);
    }
  });

  it("An address too long to send to is not shown back", async () => {
    const longEmail = `${"a".repeat(2000)}@example.test`;
    const res = await postLogin({ email: longEmail, "cf-turnstile-response": "a-failing-token" });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(formTag(html)).not.toBeNull();
    expect(html).not.toContain("a".repeat(255));
  });

  it("Requesting a link while Turnstile can't be reached is refused", async () => {
    const before = await verificationIds();
    const res = await postLogin({
      email: "turnstile-down@example.test",
      "cf-turnstile-response": "siteverify-down",
    });
    expect(res.status).toBe(503);
    const html = await res.text();
    expect(formTag(html)).not.toBeNull();
    expect(html).toContain('<p role="alert">');
    await expectNothingCreated("turnstile-down@example.test", before);
  });

  it("Requesting a link for the longest address the mailer sends to works", async () => {
    expect(LONGEST_EMAIL).toHaveLength(254);
    const res = await postLogin({ email: LONGEST_EMAIL, "cf-turnstile-response": PASSING_TOKEN });
    expect(res.status).toBe(200);
    expect(await emailsTo(LONGEST_EMAIL)).toHaveLength(1);
  });

  it("Requesting a link for an invalid address shows the form again", async () => {
    // Also none at all, and a well-formed one a character longer than the mailer sends to.
    for (const email of ["not-an-address", "", `a${LONGEST_EMAIL}`]) {
      const before = await verificationIds();
      const res = await postLogin({ email, "cf-turnstile-response": PASSING_TOKEN });
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(formTag(html)).not.toBeNull();
      expect(html).toContain('<p role="alert">Enter a valid email address.</p>');
      await expectNothingCreated(email, before);
    }
  });
});

describe("19-surge-controls-and-quotas", () => {
  it("Turnstile guards login and signup", async () => {
    const before = await verificationIds();
    const res = await postLogin({ email: "surge-turnstile@example.test" });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(formTag(html)).not.toBeNull();
    expect(html).toContain('<p role="alert">');
    await expectNothingCreated("surge-turnstile@example.test", before);
  });
});
