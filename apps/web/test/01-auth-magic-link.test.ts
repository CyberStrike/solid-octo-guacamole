import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://rarepair.fans";
// SAFETY: the default export is the Worker under test, loaded from wrangler.jsonc's main.
const worker = (exports as any).default as Fetcher;

const fetchW = (input: string, init: RequestInit = {}) =>
  worker.fetch(new URL(input, BASE).toString(), { redirect: "manual", ...init });

/** The nonce in a CSP header, or null when there is none. */
const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']*)'/)?.[1] ?? null;

/** The opening tag of the sign-in form, or null. */
const formTag = (html: string) => html.match(/<form\b[^>]*action="\/login"[^>]*>/)?.[0] ?? null;

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
    expect(html).toMatch(
      new RegExp(
        `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" nonce="${nonce}"`,
      ),
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
});
