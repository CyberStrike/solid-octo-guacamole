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
});
