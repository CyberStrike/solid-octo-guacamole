import { createDb } from "@archive/db";
import { putFragments, seedWork, type SeedChapter } from "@archive/db/seed";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchW } from "./helpers";

// Every work here has an AO3 work ID in 20000-20999 and tags named r2-..., so no other
// test file sharing the database sees them. ID 1 is never seeded: 22-waitlist expects
// /works/1/chapters/2 to be a 404.
const W = 20001;
const TAGS = [
  { type: "rating" as const, name: "r2-General Audiences" },
  { type: "fandom" as const, name: "r2-Fandom" },
];

// Work W's five chapters. Synthetic markers only: no fic text in tests.
const CHAPTERS: SeedChapter[] = [
  { html: "<p>W-ONE-TEXT</p>" },
  { html: "<p>W-TWO-TEXT</p>" },
  { html: "<p>W-THREE-TEXT</p>" },
  { html: "<p>W-FOUR-TEXT</p>" },
  { html: "<p>W-FIVE-TEXT</p>" },
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
});
