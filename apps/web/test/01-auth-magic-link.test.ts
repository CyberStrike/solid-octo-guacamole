import { createDb } from "@archive/db";
import { env, exports } from "cloudflare:workers";
import { afterAll, describe, expect, it } from "vitest";
import { parseMessage } from "../../mailer/src/message";

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
  { url = "/login", headers = {} }: { url?: string; headers?: Record<string, string> } = {},
) {
  return fetchW(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: BASE,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
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
    const mine = (await deliveredEmails()).filter((body) => parseMessage(body)?.to === to);
    if (mine.length >= atLeast || Date.now() > deadline) return mine.map((b) => parseMessage(b)!);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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
});
