import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// Runs in the "prelaunch" project: wrangler.jsonc exactly as it deploys, PRELAUNCH on.

const BASE = "https://rarepair.fans";
// SAFETY: the default export is the Worker under test, loaded from wrangler.jsonc's main.
const worker = (exports as any).default as Fetcher;

const fetchW = (input: string, init: RequestInit = {}) =>
  worker.fetch(new URL(input, BASE).toString(), { redirect: "manual", ...init });

const TURNSTILE_API = "https://challenges.cloudflare.com/turnstile/v0/api.js";

// The policies from ARCHITECTURE, Reading, with the nonce left as {n}.
const STRICT =
  "default-src 'self'; script-src 'nonce-{n}' 'strict-dynamic'; style-src 'self'; img-src 'self' https://content.rarepair.fans; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const TURNSTILE = `${STRICT}; frame-src https://challenges.cloudflare.com`;

const HSTS = "max-age=31536000; includeSubDomains";
const IMMUTABLE = "public, max-age=31536000, immutable";

// SHA-256 of the publishers' release files (apps/web/public/assets/waitlist/fonts/PROVENANCE.md).
const UPSTREAM_WOFF2 = {
  "Fraunces 1.000, Fonts - Web/Fraunces[SOFT,WONK,opsz,wght].woff2":
    "25e420d8c154303e08322ea77f08997c4aade75653ef18425772ada5abacd0ce",
  "@ibm/plex-mono 2.5.0, fonts/complete/woff2/IBMPlexMono-Regular.woff2":
    "ba204497f16b6d334cee9d1e963a831b73e3a56e1d6300a8489d18df7214b350",
  "@ibm/plex-mono 2.5.0, fonts/complete/woff2/IBMPlexMono-Medium.woff2":
    "33faf307fa6031fb4062276d7320a6d632de890cbb347576fd80cfa01077bc25",
};
const UPSTREAM_LICENCES = {
  "/assets/waitlist/fonts/fraunces/OFL.txt":
    "bdf4c22802eaf804f998195871c6b8938aac2ac14b2d78a8bd66a6f1eced833b",
  "/assets/waitlist/fonts/ibm-plex-mono/license.txt":
    "91c25c350d3cac39da2736d74f7ba37ef648f5237a4e330a240615bc8d8c4360",
};

/** Lowercase hex SHA-256 of some bytes. */
const sha256 = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** The nonce in a CSP header, or null when there is none. */
const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']*)'/)?.[1] ?? null;

/** The header with its nonce swapped back to {n}, for whole-string comparison. */
const withoutNonce = (csp: string | null) => csp?.replace(/'nonce-[^']*'/, "'nonce-{n}'") ?? null;

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

  it("Coming-soon page allows the Turnstile frame and nothing more", async () => {
    for (const [path, method] of [
      ["/", "GET"],
      ["/", "HEAD"],
      ["/?ref=1", "GET"],
    ]) {
      const res = await fetchW(path, { method });
      expect(withoutNonce(res.headers.get("content-security-policy"))).toBe(TURNSTILE);
    }
  });

  it("Coming-soon page serves its own fonts", async () => {
    const html = await (await fetchW("/")).text();

    // One same-origin stylesheet.
    const links = tags(html, "link").filter((tag) => tag.includes('rel="stylesheet"'));
    expect(links).toHaveLength(1);
    const cssPath = links[0]?.match(/href="([^"]+)"/)?.[1] ?? "";
    expect(cssPath).toMatch(/^\/assets\//);
    const cssRes = await fetchW(cssPath);
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get("content-type")).toMatch(/^text\/css/);
    expect(cssRes.headers.get("cache-control")).toBe(IMMUTABLE);
    const cssBytes = new Uint8Array(await cssRes.arrayBuffer());
    expect(cssPath).toContain(`.${(await sha256(cssBytes)).slice(0, 16)}.css`);
    const css = new TextDecoder().decode(cssBytes);

    // Each family as woff2 from rarepair.fans, swapped in when it loads.
    const faces = css.match(/@font-face\s*{[^}]*}/g) ?? [];
    const families = faces.map((face) => face.match(/font-family:\s*"([^"]+)"/)?.[1]);
    expect(new Set(families)).toEqual(new Set(["Fraunces", "IBM Plex Mono"]));
    for (const face of faces) {
      expect(face).toMatch(/font-display:\s*swap/);
      expect(face).toMatch(/src:\s*url\("\/assets\/[^"]+\.woff2"\)\s*format\("woff2"\)/);
    }

    // Headings and text in Fraunces, labels and buttons in IBM Plex Mono.
    const rule = (selector: string) =>
      css.match(new RegExp(`(^|\\n)${selector}\\s*{([^}]*)}`))?.[2];
    expect(rule("body")).toMatch(/font-family:\s*"Fraunces"/);
    expect(rule("h1,\\s*h2")).toMatch(/font-family:\s*"Fraunces"/);
    expect(rule("label,\\s*button")).toMatch(/font-family:\s*"IBM Plex Mono"/);

    // The publishers' own files, unmodified, at content-hashed immutable paths.
    const fonts = [...css.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((m) => m[1] ?? "");
    expect(fonts).toHaveLength(Object.keys(UPSTREAM_WOFF2).length);
    const served = new Set<string>();
    for (const path of fonts) {
      const res = await fetchW(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("font/woff2");
      expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
      expect(res.headers.get("strict-transport-security")).toBe(HSTS);
      const digest = await sha256(new Uint8Array(await res.arrayBuffer()));
      expect(path).toContain(`.${digest.slice(0, 16)}.woff2`);
      served.add(digest);
    }
    expect(served).toEqual(new Set(Object.values(UPSTREAM_WOFF2)));

    // Nothing from another host but Turnstile's api.js, and no inline style for the CSP to refuse.
    const refs = [
      ...[...html.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((m) => m[1] ?? ""),
      ...[...css.matchAll(/url\(\s*["']?([^"')]*)/g)].map((m) => m[1] ?? ""),
      ...[...css.matchAll(/@import\s+["']([^"']*)/g)].map((m) => m[1] ?? ""),
    ];
    for (const ref of refs) {
      if (ref === TURNSTILE_API) continue;
      expect(new URL(ref, BASE).origin).toBe(BASE);
    }
    expect(html).not.toMatch(/<style\b|\sstyle=/i);

    // The fonts' OFL licence files, linked from the page and served from rarepair.fans.
    for (const [path, digest] of Object.entries(UPSTREAM_LICENCES)) {
      expect(html).toContain(`href="${path}"`);
      const res = await fetchW(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(await sha256(new Uint8Array(await res.arrayBuffer()))).toBe(digest);
    }

    // No other app page loads a web font. (WL2 and WL3 build the other wait list pages
    // on waitlistPage, which links the same stylesheet.)
    for (const path of ["/login", "/login/confirm"]) {
      const other = await (await fetchW(path)).text();
      expect(other).not.toMatch(/\/assets\/waitlist\/|woff2|@font-face/);
    }
  });
});
