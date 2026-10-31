import { createDb } from "@archive/db";
import { putFragments, seedWork, type SeedChapter } from "@archive/db/seed";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STRICT, fetchW, nonceOf, withoutNonce } from "./helpers";

// Every work here has an AO3 work ID in 20000-20999 and tags named r2-..., so no other
// test file sharing the database sees them. ID 1 is never seeded: 22-waitlist expects
// /works/1/chapters/2 to be a 404.
const W = 20001;
// As ingest writes it: absolute, on the content origin (ARCHITECTURE, EPUB processor step 6).
const IMAGE = `https://content.rarepair.fans/works/${W}/img/${"ab".repeat(32)}`;
const TAGS = [
  { type: "rating" as const, name: "r2-General Audiences" },
  { type: "fandom" as const, name: "r2-Fandom" },
];

// Work W's five chapters. Synthetic markers only: no fic text in tests.
const CHAPTERS: SeedChapter[] = [
  { html: "<p>W-ONE-TEXT</p>" },
  { html: "<p>W-TWO-TEXT</p>" },
  { html: "<p>W-THREE-TEXT</p>" },
  // Test only: a script that got past the sanitizer, and two headings of the chapter's own.
  {
    html: "<h1>W-FOUR-HEADING-A</h1><p>W-FOUR-TEXT</p><script>window.INJECTED = 1</script><h1>W-FOUR-HEADING-B</h1>",
  },
  { html: `<p>W-FIVE-TEXT</p><img src="${IMAGE}" alt="">` },
];

const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });

beforeAll(async () => {
  const w = await seedWork(db, {
    ao3WorkId: W,
    title: "R2 reader work",
    tags: TAGS,
    chapters: CHAPTERS,
  });
  await putFragments(env.BUCKET, w.fragments);
});

afterAll(() => db.destroy());

const chapterUrl = (id: number, n: number | string) => `/works/${id}/chapters/${n}`;

/** The markup between `<article class="chapter">` and its closing tag, or null. */
const articleOf = (html: string) =>
  html.match(/<article class="chapter">([\s\S]*)<\/article>/)?.[1] ?? null;

const htmlOf = async (path: string) => (await fetchW(path)).text();

/** The stylesheet a page links to. */
const stylesheetOf = async (html: string) => {
  const href = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
  const res = await fetchW(href ?? "/missing.css");
  expect(res.status).toBe(200);
  return res.text();
};

/** The declarations of every top-level rule whose selector list is exactly `selector`. */
const rulesFor = (css: string, selector: string) =>
  [...css.replaceAll(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?<=^|\})\s*([^{}@]+?)\s*\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(",").some((s) => s.trim() === selector))
    .map(([, , body]) => body);

describe("11-reader-and-csp", () => {
  it("Chapter renders inline in the page", async () => {
    const res = await fetchW(chapterUrl(W, 2));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await res.text();
    expect(articleOf(html)).toContain("<p>W-TWO-TEXT</p>");
    expect(html).not.toMatch(/<iframe/i);
    // No client-side epub engine: the page runs no script at all yet.
    expect(html).not.toMatch(/<script/i);
  });

  it("Script that gets past the sanitizer does not run", async () => {
    // The browser half (the script never executes) is a live check. Here: the page's
    // policy runs only scripts carrying its nonce, and the injected one has none.
    const res = await fetchW(chapterUrl(W, 4));
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy");
    expect(withoutNonce(csp)).toBe(STRICT);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    const nonce = nonceOf(csp);
    expect(nonce).toBeTruthy();
    const html = await res.text();
    expect(articleOf(html)).toContain("<script>window.INJECTED = 1</script>");
    expect(html.match(/<script\b[^>]*>/g)).toEqual(["<script>"]);
    expect(html).not.toContain(`nonce="${nonce}"`);
  });

  it("Chapter content is contained", async () => {
    // contain: content includes layout containment, which makes .chapter the containing
    // block of its fixed and absolute descendants. Layout itself is a live check.
    const css = await stylesheetOf(await htmlOf(chapterUrl(W, 2)));
    expect(rulesFor(css, "article.chapter").join("\n")).toMatch(/(^|[;\s])contain:\s*content;/);
  });
});
