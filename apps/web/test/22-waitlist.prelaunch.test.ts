import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// Runs in the "prelaunch" project: wrangler.jsonc exactly as it deploys, PRELAUNCH on.

const BASE = "https://rarepair.fans";
// SAFETY: the default export is the Worker under test, loaded from wrangler.jsonc's main.
const worker = (exports as any).default as Fetcher;

const fetchW = (input: string, init: RequestInit = {}) =>
  worker.fetch(new URL(input, BASE).toString(), { redirect: "manual", ...init });

const TURNSTILE_API = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** The nonce in a CSP header, or null when there is none. */
const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']*)'/)?.[1] ?? null;

/** Every opening tag of one element in some HTML. */
const tags = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];

describe("22-waitlist", () => {
  it("Coming-soon page shows the wait list form", async () => {
    const res = await fetchW("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const nonce = nonceOf(res.headers.get("content-security-policy"));
    const html = await res.text();

    expect(html).toMatch(/rarepair is coming soon/i);

    // An email address form, posted to /waitlist as a plain form.
    const forms = tags(html, "form");
    expect(forms).toHaveLength(1);
    expect(forms[0]).toContain('method="post"');
    expect(forms[0]).toContain('action="/waitlist"');
    const inputs = tags(html, "input");
    const email = inputs.filter((tag) => tag.includes('name="email"'));
    expect(email).toHaveLength(1);
    expect(email[0]).toContain('type="email"');

    // Turnstile alongside: its widget, and its api.js carrying the page nonce.
    expect(html).toMatch(/<div class="cf-turnstile" data-sitekey="[^"]+"/);
    const scripts = tags(html, "script");
    const apiJs = scripts.filter((tag) => tag.includes(`src="${TURNSTILE_API}"`));
    expect(apiJs).toHaveLength(1);
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);

    expect(html).toMatch(/one email when the archive opens, and nothing else/i);
  });

  it("Coming-soon page without JavaScript explains the form needs it", async () => {
    // workerd runs no page script, so this reads the HTML a browser with JavaScript off gets.
    const html = await (await fetchW("/")).text();

    // The rest of the page renders: noscript wraps only its message.
    expect(html).toMatch(
      /<noscript><p>[^<]*joining the wait list needs JavaScript[^<]*<\/p><\/noscript>/i,
    );
    expect(html.replace(/<noscript>.*?<\/noscript>/s, "")).toMatch(/rarepair is coming soon/i);

    // Nothing can submit the form: its only submit button starts disabled, which also
    // blocks submitting by pressing Enter in the email field.
    const buttons = tags(html, "button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toMatch(/\bdisabled\b/);
    expect(tags(html, "input").filter((tag) => /type="(submit|image)"/.test(tag))).toEqual([]);
  });
});
