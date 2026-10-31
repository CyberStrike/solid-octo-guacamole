import { describe, expect, it, inject } from "vitest";
import { processEpub, type ParsedWork } from "../src";
import { fromBase64 } from "./helpers";

// Real AO3 epubs live in fixtures/epubs/ locally and are git-ignored (the repo is
// public). Assertions stick to metadata, counts and short markers: no fic text.

const fixtures = inject("epubFixtures");
const names = Object.keys(fixtures);

interface Expected {
  workId: string;
  title: string;
  authors: { pseud: string; user: string | null }[];
  rating: string;
  fandoms: string[];
  relationships: number;
  relationshipIncludes?: string;
  characters: number;
  freeforms: number;
  words: number;
  published: string;
  opening: string;
}

// oxlint-disable-next-line deslop/no-known-value-widening -- each entry read as an Expected, by file name
const EXPECTED: Record<string, Expected> = {
  "***REMOVED***": {
    workId: "***REMOVED***",
    title: "***REMOVED***",
    authors: [{ pseud: "***REMOVED***", user: "***REMOVED***" }],
    rating: "Teen And Up Audiences",
    fandoms: ["***REMOVED***"],
    relationships: 1,
    characters: 4,
    freeforms: 4,
    words: 5850,
    published: "2017-10-03",
    opening: "***REMOVED***",
  },
  "***REMOVED***": {
    workId: "***REMOVED***",
    title: "***REMOVED***",
    authors: [{ pseud: "***REMOVED***", user: "***REMOVED***" }],
    rating: "General Audiences",
    fandoms: ["***REMOVED***"],
    relationships: 2,
    relationshipIncludes: '***REMOVED***',
    characters: 3,
    freeforms: 6,
    words: 3877,
    published: "2018-12-15",
    opening: "***REMOVED***",
  },
};

function expectClean(html: string): void {
  expect(html).not.toMatch(/class=|style=|<script|calibre|\son\w+=/i);
}

describe.skipIf(names.length === 0)("real AO3 fixtures (all present)", () => {
  it.each(names)("%s: parses deterministically and sanitizes everything", async (name) => {
    const bytes = fromBase64(fixtures[name]!);
    const a = await processEpub(bytes);
    const b = await processEpub(bytes);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.chapters.length).toBeGreaterThan(0);
    for (const html of [
      a.summaryHtml,
      a.notesHtml,
      a.endNotesHtml,
      ...a.chapters.map((c) => c.html),
    ]) {
      if (html !== null) expectClean(html);
    }
    // Recorded for the report: our word count vs AO3's.
    console.log(
      `${name}: AO3 words ${a.stats.words}, counted ${a.chapters.reduce((n, c) => n + c.words, 0)}`,
    );
  });
});

for (const [name, want] of Object.entries(EXPECTED)) {
  describe.skipIf(!(name in fixtures))(`fixture ${name}`, () => {
    let work: ParsedWork | undefined;
    const load = async () => (work ??= await processEpub(fromBase64(fixtures[name]!)));

    it("reads the preface metadata", async () => {
      const w = await load();
      expect(w.ao3WorkId).toBe(want.workId);
      expect(w.title).toBe(want.title);
      expect(w.authors).toEqual(want.authors);
      expect(w.rating).toBe(want.rating);
      expect(w.warnings).toEqual(["No Archive Warnings Apply"]);
      expect(w.categories).toEqual(["M/M"]);
      expect(w.fandoms).toEqual(want.fandoms);
      expect(w.relationships).toHaveLength(want.relationships);
      if (want.relationshipIncludes) expect(w.relationships).toContain(want.relationshipIncludes);
      expect(w.characters).toHaveLength(want.characters);
      expect(w.freeforms).toHaveLength(want.freeforms);
      expect(w.language).toBe("English");
      expect(w.series).toEqual([]);
      expect(w.stats).toEqual({
        published: want.published,
        updated: null,
        completed: null,
        words: want.words,
        chapters: { posted: 1, total: 1 },
      });
      expect(w.rawMeta).toEqual({});
      expect(w.reviewReasons).toEqual([]);
      expect(w.images).toEqual([]);
    });

    it("finds exactly one chapter with the work title", async () => {
      const w = await load();
      expect(w.chapters).toHaveLength(1);
      const [chapter] = w.chapters;
      expect(chapter!.n).toBe(1);
      expect(chapter!.title).toBe(want.title);
      expect(chapter!.html.length).toBeGreaterThan(1000);
      expect(chapter!.html.replace(/\s+/g, " ")).toContain(want.opening);
      expect(chapter!.html).not.toMatch(/<h2/);
      expect(chapter!.words).toBeGreaterThan(want.words * 0.9);
      expectClean(chapter!.html);
    });

    it("keeps summary, notes and end notes, sanitized", async () => {
      const w = await load();
      for (const html of [w.summaryHtml, w.notesHtml, w.endNotesHtml]) {
        expect(html).toMatch(/^<p>/);
        expectClean(html!);
      }
      expect(w.notesHtml).not.toMatch(/See the end of the work/);
    });

    it("drops the archive's comment prompt", async () => {
      const w = await load();
      expect(JSON.stringify(w)).not.toMatch(/drop by the archive and comment/i);
    });
  });
}
