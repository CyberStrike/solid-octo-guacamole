import { createDb } from "@archive/db";
import { seedWork } from "@archive/db/seed";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchW, nonceOf, STRICT, withoutNonce } from "./helpers";

// One database serves every test file in the run, so this file keeps to AO3 work
// IDs 12345 to 12399 and to tag names starting "r1-", and a tag listing elsewhere
// never sees its works. Text is synthetic.
const W = 12345;
const A = 12346;
/** Live, with review reasons no moderator has cleared. */
const F = 12347;
/** Live, with review reasons a moderator has cleared. */
const CHECKED = 12348;
/** Two co-authors, the byline naming Zed first. Its chapter total is unknown. */
const COAUTHORED = 12349;
/** Markup in every stored string. */
const HOSTILE = 12350;

// The site chrome test's check: names only as provenance, never in the page.
const BRANDING = /AO3|OTW|Archive of Our Own|Organization for Transformative Works/i;

// Work W's tags, in the author's order, grouped by type as an AO3 export lists them.
const W_TAGS = [
  { type: "rating", name: "Mature" },
  { type: "warning", name: "Graphic Depictions Of Violence" },
  { type: "category", name: "r1-Category" },
  { type: "fandom", name: "r1-Fandom One" },
  { type: "fandom", name: "r1-Fandom Two" },
  { type: "relationship", name: "r1-Bee/r1-Cee" },
  { type: "relationship", name: "r1-Ay/r1-Bee" },
  { type: "character", name: "r1-Cee" },
  { type: "character", name: "r1-Ay" },
  { type: "freeform", name: "r1-Slow Burn" },
  { type: "freeform", name: "r1-Found Family" },
] as const;

// The other works' tags: none of seedWork's shared defaults.
const FEW_TAGS = [
  { type: "rating", name: "General Audiences" },
  { type: "fandom", name: "r1-Fandom One" },
] as const;

const LONG_SUMMARY = `<p>${"A synthetic summary sentence. ".repeat(40)}</p><p>The last paragraph of it.</p>`;

const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });

beforeAll(async () => {
  await seedWork(db, {
    ao3WorkId: W,
    title: "r1 Work W",
    rating: "Mature",
    authors: [{ pseud: "r1-pseud", ao3_user: "r1_user" }],
    tags: [...W_TAGS],
    chapters: Array.from({ length: 5 }, (_, i) => ({ title: `r1 chapter ${i + 1}`, words: 1200 })),
    chapterTotal: 7,
    complete: false,
  });
  await seedWork(db, {
    ao3WorkId: A,
    anonymous: true,
    rating: "General Audiences",
    tags: [...FEW_TAGS],
  });
  await seedWork(db, { ao3WorkId: F, reviewReasons: ["missing_rating"], tags: [...FEW_TAGS] });
  const checked = await seedWork(db, {
    ao3WorkId: CHECKED,
    reviewReasons: ["missing_rating"],
    tags: [...FEW_TAGS],
  });
  await db
    .updateTable("work_versions")
    .set({ checked_at: new Date().toISOString() })
    .where("id", "=", checked.versionId)
    .execute();
  await seedWork(db, {
    ao3WorkId: COAUTHORED,
    authors: [
      { pseud: "r1-Zed", ao3_user: "r1_zed" },
      { pseud: "r1-Amy", ao3_user: "r1_amy" },
    ],
    tags: [...FEW_TAGS],
  });
  await seedWork(db, {
    ao3WorkId: HOSTILE,
    title: 'r1 <script>alert(1)</script> "quoted"',
    authors: [{ pseud: 'r1 <b onclick="x">pseud</b>', ao3_user: null }],
    tags: [
      { type: "rating", name: "General Audiences" },
      { type: "fandom", name: 'r1-Fandom"><script>alert(2)</script>' },
      { type: "freeform", name: "r1-<img src=x onerror=alert(3)>" },
    ],
    chapters: [{ title: "r1 <script>alert(4)</script>" }],
  });
  await db
    .updateTable("works")
    .set({ summary_html: LONG_SUMMARY })
    .where("ao3_work_id", "=", W)
    .execute();
});

afterAll(async () => {
  await db.destroy();
});

const page = async (path: string) => {
  const res = await fetchW(path);
  return { res, html: await res.text() };
};

/** The block holding the link to the original work and its note. */
const originalBlock = (html: string) => html.match(/<p class="original">[\s\S]*?<\/p>/)?.[0] ?? "";

const TAG = /<span class="visually-hidden">([^<]*): <\/span><a href="([^"]*)">([^<]*)<\/a>/g;

/**
 * The tag list: each tag as [hidden label, href, name], the text between tags,
 * and the list's markup.
 */
const tagList = (html: string) => {
  const list = html.match(/<p class="tags">([\s\S]*?)<\/p>/)?.[1] ?? "";
  return {
    html: list,
    items: [...list.matchAll(TAG)].map((m) => [m[1], m[2], m[3]]),
    separators: list
      .split(TAG)
      .filter((_, i) => i % 4 === 0)
      .slice(1, -1),
  };
};

/** The stylesheet a page links to, as the Worker serves it. */
const stylesheetOf = async (html: string) => {
  const href = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
  const res = await fetchW(href ?? "/missing.css");
  expect(res.status).toBe(200);
  return res.text();
};

describe("10-work-page", () => {
  it("Work page shows full metadata", async () => {
    const { res, html } = await page(`/works/${W}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(html).toContain("<h1>r1 Work W</h1>");
    expect(html).toContain("r1-pseud");
    expect(html).toContain("Mature");
    expect(html).toContain("Graphic Depictions Of Violence");
    expect(html).toContain("r1-Fandom One");
    expect(html).toContain("r1-Fandom Two");
    // The full summary, as stored: sanitized at ingest, never clamped or cut.
    expect(html).toContain(LONG_SUMMARY);
    for (const tag of [
      "r1-Bee/r1-Cee",
      "r1-Ay/r1-Bee",
      "r1-Cee",
      "r1-Ay",
      "r1-Slow Burn",
      "r1-Found Family",
    ]) {
      expect(html).toContain(`>${tag}</a>`);
    }
    // Stats: words, chapters posted of planned, in progress.
    expect(html).toMatch(/6,000/);
    expect(html).toContain("5/7");
    expect(html).toMatch(/in progress/i);
    for (let n = 1; n <= 5; n++) expect(html).toContain(`r1 chapter ${n}`);
  });

  it("Rating and warnings are always visible", async () => {
    const { html } = await page(`/works/${W}`);
    // One line of plain text, in full, in an ordinary element.
    const line = html.match(/<p class="rating-warnings">([^<]*)<\/p>/);
    expect(line?.[1]).toBe("Mature · Graphic Depictions Of Violence");
    expect(html).not.toMatch(/<details\b/);
    expect(html).not.toMatch(/\b(hidden|aria-hidden|title)=/);
    // Weight 600, like the author line's size (FRONTEND-DISCOVERY, Hierarchy), and
    // nothing in the stylesheet clamps, cuts or hides it, at any width.
    const css = await stylesheetOf(html);
    const rules = css.match(/[^{}]*\.rating-warnings[^{}]*\{[^}]*\}/g) ?? [];
    expect(rules.join("\n")).toMatch(/font-weight:\s*600/);
    for (const rule of rules) {
      expect(rule).not.toMatch(
        /line-clamp|text-overflow|display:\s*none|overflow:\s*hidden|nowrap/,
      );
    }
  });

  it("Hierarchy follows the set order", async () => {
    const { html } = await page(`/works/${W}`);
    const order = [
      "<h1>",
      'class="authors"',
      'class="rating-warnings"',
      'class="fandoms"',
      'class="summary"',
      'class="tags"',
      'class="stats"',
    ].map((marker) => html.indexOf(marker));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("Original AO3 link is live with a note", async () => {
    const { html } = await page(`/works/${W}`);
    const block = originalBlock(html);
    expect(block).toContain('<a href="https://archiveofourown.org/works/12345">');
    expect(block).toMatch(/works again once .* is back/i);
  });

  it("No redirect to AO3 when AO3 is reachable again", async () => {
    // Nothing switches on the original's state: the page is always served here.
    const { res, html } = await page(`/works/${W}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    // The link and its note, as in the case before.
    const block = originalBlock(html);
    expect(block).toContain('<a href="https://archiveofourown.org/works/12345">');
    expect(block).toMatch(/works again once .* is back/i);
  });

  it("Work page states it is unofficial", async () => {
    const { html } = await page(`/works/${W}`);
    const main = html.match(/<main\b[\s\S]*<\/main>/)?.[0] ?? "";
    expect(main).toMatch(/unofficial stopgap/i);
    expect(html).not.toMatch(BRANDING);
    expect(await stylesheetOf(html)).not.toMatch(BRANDING);
  });

  it("Anonymous author shown as Anonymous", async () => {
    const { html } = await page(`/works/${A}`);
    expect(html.match(/<p class="authors">([^<]*)<\/p>/)?.[1]).toBe("by Anonymous");
  });

  it("Tags are an inline list of links", async () => {
    const { html } = await page(`/works/${W}`);
    const list = tagList(html);
    // Comma-separated, every tag a link with a real href, in the stored order,
    // each after its hidden type label. Rating, warnings and fandoms have their own lines.
    // The href is /tags/<type>/<name_norm> (the tag rule folds "-" to a space).
    expect(list.items).toEqual([
      ["Category", "/tags/category/r1%20category", "r1-Category"],
      ["Relationship", "/tags/relationship/r1%20bee%2Fr1%20cee", "r1-Bee/r1-Cee"],
      ["Relationship", "/tags/relationship/r1%20ay%2Fr1%20bee", "r1-Ay/r1-Bee"],
      ["Character", "/tags/character/r1%20cee", "r1-Cee"],
      ["Character", "/tags/character/r1%20ay", "r1-Ay"],
      ["Additional tag", "/tags/freeform/r1%20slow%20burn", "r1-Slow Burn"],
      ["Additional tag", "/tags/freeform/r1%20found%20family", "r1-Found Family"],
    ]);
    expect(list.separators.every((s) => s === ", ")).toBe(true);
    expect(list.separators).toHaveLength(6);
    // The type is never carried by colour: no class or style on the links.
    expect(list.html).not.toMatch(/<a [^>]*(class|style)=/);
    const css = await stylesheetOf(html);
    expect(css).toMatch(/\.tags\s*\{[^}]*font-size:\s*var\(--text-1\)/);
  });
});

describe("10-work-page, its links", () => {
  it("Chapter list links to each chapter", async () => {
    const { html } = await page(`/works/${W}`);
    const list = html.match(/<ol class="chapters">[\s\S]*?<\/ol>/)?.[0] ?? "";
    const links = [...list.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
    expect(links).toEqual([
      ["/works/12345/chapters/1", "r1 chapter 1"],
      ["/works/12345/chapters/2", "r1 chapter 2"],
      ["/works/12345/chapters/3", "r1 chapter 3"],
      ["/works/12345/chapters/4", "r1 chapter 4"],
      ["/works/12345/chapters/5", "r1 chapter 5"],
    ]);
    expect(html.match(/<a href="\/works\/12345\/full">/g)).toHaveLength(1);
  });

  it("Download original link is offered", async () => {
    const { html } = await page(`/works/${W}`);
    const links = [...html.matchAll(/<a href="([^"]*)">Download original epub<\/a>/g)];
    expect(links).toHaveLength(1);
    // The content Worker's one form for an original: one plain path segment
    // (apps/content). The segment itself waits on #119.
    expect(links[0]?.[1]).toMatch(
      /^https:\/\/content\.rarepair\.fans\/originals\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/,
    );
  });
});

describe("10-work-page, the review notice", () => {
  const NOTICE = "Chapters may be imperfect; a moderator will check.";

  it("Work with review reasons shows the notice", async () => {
    const { html } = await page(`/works/${F}`);
    expect(html).toContain(`<p class="review-notice">${NOTICE}</p>`);
    expect((await page(`/works/${W}`)).html).not.toContain(NOTICE);
  });

  it("The notice goes once a moderator has checked the work", async () => {
    expect((await page(`/works/${CHECKED}`)).html).not.toContain(NOTICE);
  });
});

describe("10-work-page, no such work", () => {
  it("Unknown work shows the not-found page", async () => {
    // Never seeded; not an ID at all; and other spellings of W's ID, which name no
    // work: only the plain decimal form is an AO3 work ID.
    for (const id of ["999999999", "abc", "0", "0x3039", "1.2345e4", "012345", "12345.0"]) {
      const res = await fetchW(`/works/${id}`);
      const html = await res.text();
      expect(res.status, id).toBe(404);
      expect(html, id).toMatch(/<form role="search" method="get" action="\/search">/);
      expect(html, id).toMatch(/<input type="search" id="q" name="q"/);
      expect(html, id).toMatch(/<main[\s\S]*<a href="\/">[\s\S]*<\/main>/);
    }
  });
});

describe("10-work-page, other works", () => {
  it("Co-authors are shown in byline order", async () => {
    const { html } = await page(`/works/${COAUTHORED}`);
    expect(html.match(/<p class="authors">([^<]*)<\/p>/)?.[1]).toBe("by r1-Zed, r1-Amy");
  });

  it("An unknown chapter total shows as ?", async () => {
    const { html } = await page(`/works/${COAUTHORED}`);
    expect(html.match(/<p class="stats">([^<]*)<\/p>/)?.[1]).toContain("Chapters 1/?");
  });

  it("Stored text is escaped, never run as markup", async () => {
    const { html } = await page(`/works/${HOSTILE}`);
    expect(html).not.toMatch(/<script|<img|<b /);
    expect(html).toContain("<h1>r1 &lt;script&gt;alert(1)&lt;/script&gt; &quot;quoted&quot;</h1>");
    expect(html).toContain("r1 &lt;b onclick=&quot;x&quot;&gt;pseud&lt;/b&gt;");
    expect(html).toContain("r1-Fandom&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;</a>");
    expect(html).toContain("r1-&lt;img src=x onerror=alert(3)&gt;</a>");
    expect(html).toContain("r1 &lt;script&gt;alert(4)&lt;/script&gt;</a>");
    // Every tag href is percent-encoded: no quote or angle bracket survives into it.
    for (const [, href] of html.matchAll(/<a href="([^"]*)"/g)) {
      expect(href).not.toMatch(/[<>"' ]/);
    }
  });

  it("The work page carries the site chrome, the strict CSP and no cookie", async () => {
    const { res, html } = await page(`/works/${W}`);
    const csp = res.headers.get("content-security-policy");
    expect(nonceOf(csp)).toMatch(/^[A-Za-z0-9+/_-]{16,}={0,2}$/);
    // The strict policy, with no frame-src: work pages never embed anything.
    expect(withoutNonce(csp)).toBe(STRICT);
    expect(res.headers.get("strict-transport-security")).toMatch(/max-age/);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(html).not.toMatch(/<script/i);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.match(/<[a-z]+ class="banner"/g)).toHaveLength(1);
    expect(html).toContain('<footer><a href="/remove">Remove my work</a>');
  });
});

describe("21-accessibility-and-no-js", () => {
  it("Tag types are announced without colour", async () => {
    const { html } = await page(`/works/${W}`);
    const list = tagList(html);
    // Every link in the list has its own label, and the label class hides it from sight only.
    expect(list.items).toHaveLength((list.html.match(/<a\b/g) ?? []).length);
    expect(list.items.map(([label]) => label)).toEqual([
      "Category",
      "Relationship",
      "Relationship",
      "Character",
      "Character",
      "Additional tag",
      "Additional tag",
    ]);
    const css = await stylesheetOf(html);
    const rule = css.match(/\.visually-hidden\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });
});

describe("20-site-chrome-and-legal", () => {
  it("Credit goes to the original work", async () => {
    for (const id of [W, A]) {
      const { html } = await page(`/works/${id}`);
      expect(originalBlock(html), String(id)).toContain(
        `<a href="https://archiveofourown.org/works/${id}">`,
      );
    }
  });
});
