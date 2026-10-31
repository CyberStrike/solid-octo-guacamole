import { createDb } from "@archive/db";
import { seedWork } from "@archive/db/seed";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchW } from "./helpers";

// One database serves every test file in the run, so this file keeps to AO3 work
// IDs 12345 to 12399 and to tag names starting "r1-", and a tag listing elsewhere
// never sees its works. Text is synthetic.
const W = 12345;

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
});
