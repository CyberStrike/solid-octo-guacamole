import { createDb } from "@archive/db";
import { seedWork } from "@archive/db/seed";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchW } from "./helpers";

// Work IDs 30000-30999 and these tag names are this file's alone: one database
// serves every test file in the project, and a listing sees whatever shares its tag.
const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
afterAll(async () => {
  await db.destroy();
});

const htmlOf = async (path: string) => {
  const res = await fetchW(path);
  expect(res.status, path).toBe(200);
  return res.text();
};

/** The card that links to this work, or "" when the page has none. */
const cardOf = (html: string, ao3WorkId: number) =>
  html
    .split(/<li class="work-card">/)
    .slice(1)
    .map((card) => card.slice(0, card.indexOf("</li>")))
    .find((card) => card.includes(`href="/works/${ao3WorkId}"`)) ?? "";

/** The inner HTML of the card's element with this class, or null. */
const lineOf = (card: string, className: string) =>
  card.match(new RegExp(`<(p|div) class="${className}">([\\s\\S]*?)</\\1>`))?.[2] ?? null;

const textOf = (html: string) => html.replace(/<[^>]*>/g, "");

const stylesheetOf = async (html: string) => {
  const href = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
  return htmlOf(href ?? "/missing.css");
};

/** The declarations of every rule whose selector names this class. */
const rulesFor = (css: string, className: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => new RegExp(`\\.${className}\\b`).test(selector ?? ""))
    .map(([, , body]) => body)
    .join("\n");

const SYMBOLS = /<img|<svg|\p{Extended_Pictographic}/u;

describe("14-browse-and-home", () => {
  beforeAll(async () => {
    await seedWork(db, { ao3WorkId: 30001, tags: [{ type: "fandom", name: "Harry Potter" }] });
    await seedWork(db, { ao3WorkId: 30002, tags: [{ type: "fandom", name: "harry  potter!" }] });
    await seedWork(db, {
      ao3WorkId: 30003,
      status: "hidden",
      hiddenCause: "removal_request",
      tags: [{ type: "fandom", name: "Harry Potter" }],
    });
  });

  it("Tag matching uses the normalized form", async () => {
    const html = await htmlOf("/tags/fandom/harry%20potter");

    expect(cardOf(html, 30001)).toContain(">Harry Potter</a>");
    expect(cardOf(html, 30002)).toContain(">harry  potter!</a>");
    // Hidden works are left out of listings.
    expect(html).not.toContain('href="/works/30003"');
  });

  it("Work card line order", async () => {
    await seedWork(db, {
      ao3WorkId: 30010,
      title: "Line Order Title",
      authors: [{ pseud: "Line Order Author", ao3_user: "line_order" }],
      rating: "Teen And Up Audiences",
      summary: "<p>Line order summary.</p>",
      chapters: [{ words: 1500 }],
      updatedAt: "2024-03-05T00:00:00Z",
      tags: [
        { type: "freeform", name: "Line Order Freeform" },
        { type: "character", name: "Line Order Character" },
        { type: "relationship", name: "Line Order A/B" },
        { type: "fandom", name: "Line Order Fandom" },
        { type: "warning", name: "No Archive Warnings Apply" },
        { type: "rating", name: "Teen And Up Audiences" },
      ],
    });

    const card = cardOf(await htmlOf("/tags/fandom/line%20order%20fandom"), 30010);

    const lines = [
      "Line Order Title",
      "Line Order Author",
      "Teen And Up Audiences · No Archive Warnings Apply",
      "Line Order Fandom",
      "Line order summary.",
      "Line Order A/B",
      "1,500 words",
    ];
    const at = lines.map((text) => card.indexOf(text));
    expect(
      at.every((i) => i >= 0),
      JSON.stringify(at),
    ).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("Rating and warnings spelled out on cards", async () => {
    await seedWork(db, {
      ao3WorkId: 30020,
      rating: "Mature",
      tags: [
        { type: "rating", name: "Mature" },
        { type: "warning", name: "Graphic Depictions Of Violence" },
        { type: "fandom", name: "Spelled Out Fandom" },
      ],
    });
    await seedWork(db, {
      ao3WorkId: 30021,
      rating: null,
      tags: [{ type: "fandom", name: "Spelled Out Fandom" }],
    });

    const html = await htmlOf("/tags/fandom/spelled%20out%20fandom");

    const line = lineOf(cardOf(html, 30020), "card-rating") ?? "";
    expect(line).toBe("<strong>Mature · Graphic Depictions Of Violence</strong>");
    expect(lineOf(cardOf(html, 30021), "card-rating")).toBe("<strong>Not Rated</strong>");
    expect(cardOf(html, 30020)).not.toMatch(SYMBOLS);
    expect(cardOf(html, 30020)).not.toMatch(/style=/);
    expect(rulesFor(await stylesheetOf(html), "card-rating")).not.toMatch(/color|background/);
  });

  // The 360 px layout itself needs a browser: here, the HTML and the stylesheet.
  it("Warnings line is never truncated", async () => {
    const warnings = [
      "Creator Chose Not To Use Archive Warnings",
      "Graphic Depictions Of Violence",
      "Major Character Death",
    ];
    await seedWork(db, {
      ao3WorkId: 30030,
      rating: "Explicit",
      tags: [
        ...warnings.map((name) => ({ type: "warning" as const, name })),
        { type: "fandom", name: "Long Warnings Fandom" },
      ],
    });

    const html = await htmlOf("/tags/fandom/long%20warnings%20fandom");

    expect(textOf(lineOf(cardOf(html, 30030), "card-rating") ?? "")).toBe(
      `Explicit · ${warnings.join(", ")}`,
    );
    const rules = rulesFor(await stylesheetOf(html), "card-rating");
    expect(rules).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rules).not.toMatch(
      /line-clamp|overflow:\s*hidden|text-overflow|white-space:\s*nowrap|max-height|\bheight/,
    );
  });

  it("Summary is clamped with a more link", async () => {
    const summary = Array.from(
      { length: 12 },
      (_, i) => `<p>Clamped summary paragraph ${i + 1}, long enough to fill a line.</p>`,
    ).join("");
    await seedWork(db, {
      ao3WorkId: 30040,
      summary,
      tags: [{ type: "fandom", name: "Clamped Summary Fandom" }],
    });
    await seedWork(db, {
      ao3WorkId: 30041,
      summary: null,
      tags: [{ type: "fandom", name: "Clamped Summary Fandom" }],
    });

    const html = await htmlOf("/tags/fandom/clamped%20summary%20fandom");

    const card = cardOf(html, 30040);
    expect(lineOf(card, "card-summary")).toBe(summary);
    const more = card.indexOf('<a href="/works/30040">more</a>');
    expect(more).toBeGreaterThan(card.indexOf("Clamped summary paragraph 12"));
    expect(cardOf(html, 30041)).not.toContain(">more</a>");
    const rules = rulesFor(await stylesheetOf(html), "card-summary");
    expect(rules).toMatch(/(^|[^-])line-clamp:\s*3/);
    expect(rules).toMatch(/-webkit-line-clamp:\s*3/);
  });
});
