import { createDb } from "@archive/db";
import { putFragments, seedWork, type SeedChapter } from "@archive/db/seed";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STRICT, fetchW, nonceOf, withoutNonce } from "./helpers";

// Every work here has an AO3 work ID in 20000-20999 and tags named r2-..., so no other
// test file sharing the database sees them. ID 1 is never seeded: 22-waitlist expects
// /works/1/chapters/2 to be a 404.
const W = 20001;
// User text from the database, so the page must escape it.
const TITLE = `R2 <b>reader</b> & "work"`;
const TITLE_ESCAPED = "R2 &lt;b&gt;reader&lt;/b&gt; &amp; &quot;work&quot;";
// As ingest writes it: absolute, on the content origin (ARCHITECTURE, EPUB processor step 6).
const IMAGE = `https://content.rarepair.fans/works/${W}/img/${"ab".repeat(32)}`;
const TAGS = [
  { type: "rating" as const, name: "r2-General Audiences" },
  { type: "fandom" as const, name: "r2-Fandom" },
];

// Work W's five chapters. Synthetic markers only: no fic text in tests.
const CHAPTERS: SeedChapter[] = [
  { html: "<p>W-ONE-TEXT</p>" },
  // Notes are inline in the fragment, around the text, as the processor writes them.
  {
    html: "<p>Chapter Notes</p><blockquote><p>W-TWO-NOTES</p></blockquote><p>W-TWO-TEXT</p><p>Chapter End Notes</p><blockquote><p>W-TWO-END-NOTES</p></blockquote>",
  },
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
    title: TITLE,
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

/** The page before the chapter's article and after it. */
const aroundArticle = (html: string) => {
  const start = html.indexOf('<article class="chapter">');
  const end = html.lastIndexOf("</article>");
  expect(start).toBeGreaterThan(-1);
  return { top: html.slice(0, start), bottom: html.slice(end) };
};

/** The text of every link to `href`. */
const linksTo = (html: string, href: string) =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .filter(([, attrs]) => attrs.includes(`href="${href}"`))
    .map(([, , text]) => text);

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

  it("Chapter nav at both ends", async () => {
    const { top, bottom } = aroundArticle(await htmlOf(chapterUrl(W, 3)));
    for (const [end, html] of Object.entries({ top, bottom })) {
      expect(linksTo(html, chapterUrl(W, 2)), end).toEqual([expect.stringMatching(/previous/i)]);
      expect(linksTo(html, chapterUrl(W, 4)), end).toEqual([expect.stringMatching(/next/i)]);
      const selects = html.match(/<select\b[\s\S]*?<\/select>/g) ?? [];
      expect(selects, end).toHaveLength(1);
      const options = [...selects[0].matchAll(/<option value="(\d+)"/g)].map(([, n]) => n);
      expect(options, end).toEqual(["1", "2", "3", "4", "5"]);
      expect(selects[0], end).toMatch(/<option value="3" selected>/);
    }
  });

  it("Chapter select works without JS", async () => {
    const html = await htmlOf(chapterUrl(W, 3));
    const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].filter(([, , inner]) =>
      inner.includes("<select"),
    );
    expect(forms).toHaveLength(2);
    for (const [, attrs, inner] of forms) {
      // What a browser does with JavaScript off: picks option 5 and submits the form.
      const action = attrs.match(/action="([^"]*)"/)?.[1] ?? "";
      const method = attrs.match(/method="([^"]*)"/)?.[1] ?? "get";
      const name = inner.match(/<select\b[^>]*name="([^"]*)"/)?.[1] ?? "";
      expect(method.toLowerCase()).toBe("get");
      expect(inner).toMatch(/<button\b[^>]*type="submit"/);
      const url = new URL(action, new URL(chapterUrl(W, 3), "https://rarepair.fans"));
      url.search = new URLSearchParams({ [name]: "5" }).toString();

      const res = await fetchW(url.pathname + url.search);
      expect(res.status).toBeGreaterThanOrEqual(301);
      expect(res.status).toBeLessThanOrEqual(308);
      expect(res.headers.get("location")).toBe(chapterUrl(W, 5));
      const chapter5 = await htmlOf(res.headers.get("location") ?? "");
      expect(articleOf(chapter5)).toContain("W-FIVE-TEXT");
    }
    // The Location is made from numbers only: anything else is not found, never a redirect.
    for (const query of ["", "?n=", "?n=05", "?n=5x", "?n=//evil.example", "?n=%2F%2Fevil"]) {
      const res = await fetchW(`/works/${W}/chapters${query}`);
      expect(res.status, query).toBe(404);
      expect(res.headers.get("location"), query).toBeNull();
    }
  });

  it("Notes surround the chapter text", async () => {
    // The order half. The smaller, muted style needs a hook the sanitizer strips today
    // (filed as its own issue).
    const html = await htmlOf(chapterUrl(W, 2));
    const article = articleOf(html) ?? "";
    const notes = article.indexOf("W-TWO-NOTES");
    const text = article.indexOf("W-TWO-TEXT");
    const endNotes = article.indexOf("W-TWO-END-NOTES");
    expect(notes).toBeGreaterThan(-1);
    expect(text).toBeGreaterThan(notes);
    expect(endNotes).toBeGreaterThan(text);
    // seedWork's summary is "A seeded summary.": the reader doesn't repeat it.
    expect(html).not.toContain("A seeded summary");
  });

  it("Slim top bar", async () => {
    const html = await htmlOf(chapterUrl(W, 3));
    const main = html.match(/<main\b[^>]*>([\s\S]*)<\/main>/)?.[1] ?? "";
    const bar = main.match(/<div class="reader-bar">([\s\S]*?)<\/div>/)?.[1] ?? "";
    // The work title is the page's one h1, in the bar, escaped; the settings link beside it.
    expect(bar).toContain(`<h1>${TITLE_ESCAPED}</h1>`);
    expect(bar).toMatch(/<a href="\/settings\/reader">[^<]+<\/a>/);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain("<b>reader</b>");
    // It comes before the chapter and its nav, and it scrolls away: nothing pins it.
    expect(main.indexOf('class="reader-bar"')).toBeLessThan(main.indexOf("<nav"));
    const css = await stylesheetOf(html);
    expect(rulesFor(css, ".reader-bar").join("\n")).not.toMatch(/position:\s*(sticky|fixed)/);
  });

  it("Chapter number out of range", async () => {
    const paths = [
      chapterUrl(W, 6),
      // Not chapter numbers at all.
      ...["0", "-1", "abc", "1.5", "007", "5%20", "%205", "99999", "2147483648"].map((n) =>
        chapterUrl(W, n),
      ),
      // No such work, and work IDs that can't be one.
      chapterUrl(20999, 1),
      ...["0", "020001", "2147483648", "1e3", "%2B20001"].map((id) => `/works/${id}/chapters/1`),
    ];
    for (const path of paths) {
      const res = await fetchW(path);
      expect(res.status, path).toBe(404);
      const html = await res.text();
      // The not-found page, and no chapter.
      expect(html, path).toContain("<h1>Page not found</h1>");
      expect(html, path).toMatch(/<form role="search"/);
      expect(html, path).not.toContain('<article class="chapter">');
      expect(html, path).not.toContain("W-");
    }
  });

  it("Browser features keep working", async () => {
    // Find, print, select and screen readers are live checks. What the page controls:
    // the text is ordinary markup in the document, and nothing hides it or blocks selection.
    const html = await htmlOf(chapterUrl(W, 3));
    expect(html).toMatch(/<article class="chapter"><p>W-THREE-TEXT<\/p><\/article>/);
    expect(html).not.toMatch(/aria-hidden|inert\b|hidden\b[^>]*class="chapter"/);
    const css = await stylesheetOf(html);
    expect(css).not.toMatch(/user-select:\s*none/);
    expect(css).not.toMatch(/@media print/);
    for (const selector of ["article.chapter", ".chapter", "article"]) {
      expect(rulesFor(css, selector).join("\n"), selector).not.toMatch(
        /display:\s*none|visibility:\s*hidden|content-visibility/,
      );
    }
  });

  it("First chapter has no previous link", async () => {
    const html = await htmlOf(chapterUrl(W, 1));
    expect(html).not.toMatch(/rel="prev"|>Previous/i);
    expect(linksTo(html, chapterUrl(W, 0))).toEqual([]);
    expect(linksTo(html, chapterUrl(W, 2))).toHaveLength(2);
    expect(html.match(/<select\b/g)).toHaveLength(2);
  });

  it("Last chapter has no next link", async () => {
    const html = await htmlOf(chapterUrl(W, 5));
    expect(html).not.toMatch(/rel="next"|>Next/i);
    expect(linksTo(html, chapterUrl(W, 6))).toEqual([]);
    expect(linksTo(html, chapterUrl(W, 4))).toHaveLength(2);
    expect(html.match(/<select\b/g)).toHaveLength(2);
  });
});

describe("09-content-origin", () => {
  it("Images are served from the content origin", async () => {
    const res = await fetchW(chapterUrl(W, 5));
    const html = await res.text();
    // The fragment's absolute URL as ingest wrote it: not rewritten, proxied or dropped.
    const sources = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)].map(([, src]) => src);
    expect(sources).toEqual([IMAGE]);
    expect(new URL(sources[0]).origin).toBe("https://content.rarepair.fans");
    expect(res.headers.get("content-security-policy")).toContain(
      "img-src 'self' https://content.rarepair.fans;",
    );
  });
});

describe("21-accessibility-and-no-js", () => {
  it("Headings inside chapter content are not counted", async () => {
    const html = await htmlOf(chapterUrl(W, 4));
    const article = articleOf(html) ?? "";
    expect(article).toContain(
      "<h1>W-FOUR-HEADING-A</h1><p>W-FOUR-TEXT</p><script>window.INJECTED = 1</script><h1>W-FOUR-HEADING-B</h1>",
    );
    const chrome = html.replace(article, "");
    expect(chrome.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g)).toEqual([`<h1>${TITLE_ESCAPED}</h1>`]);
  });
});
