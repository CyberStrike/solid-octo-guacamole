import { createDb } from "@archive/db";
import { seedWork } from "@archive/db/seed";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchW } from "./helpers";

// One database serves every test file in the run, so this file keeps to AO3 work
// IDs 12345 to 12399 and to tag names starting "r1-", and a tag listing elsewhere
// never sees its works. Text is synthetic.
const W = 12345;
const A = 12346;

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
    tags: [
      { type: "rating", name: "General Audiences" },
      { type: "fandom", name: "r1-Fandom One" },
    ],
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
    expect(originalBlock(html)).toBe(originalBlock((await page(`/works/${W}`)).html));
    expect(originalBlock(html)).toContain('<a href="https://archiveofourown.org/works/12345">');
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
