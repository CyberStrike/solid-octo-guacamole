import { describe, expect, it, inject } from "vitest";
import { processEpub, type ParsedWork } from "../src";
import { fromBase64 } from "./helpers";

// Real AO3 epubs live in fixtures/epubs/ locally and are git-ignored (the repo is
// public). The repo holds no real text, not even titles or names: each real string
// is compared by the SHA-256 of its UTF-8 bytes, and the rest by count or length.

const fixtures = inject("epubFixtures");
const names = Object.keys(fixtures);

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

interface Expected {
  workIdSha: string;
  titleSha: string;
  authors: { pseudSha: string; userSha: string | null }[];
  rating: string;
  fandomShas: string[];
  relationships: number;
  relationshipIncludesSha?: string;
  characters: number;
  freeforms: number;
  words: number;
  published: string;
  // Where the chapter's first words sit in its whitespace-collapsed HTML.
  opening: { offset: number; length: number; sha: string };
}

// oxlint-disable-next-line deslop/no-known-value-widening -- each entry read as an Expected, by file name
const EXPECTED: Record<string, Expected> = {
  "call-me-maybe.epub": {
    workIdSha: "4e6aef0695cc00317626392583f10f3d3b6e55a0d25071af0bfd3e526014e70a",
    titleSha: "8138dbd6458155c7d5f7bcf3031e34553cbf445ef5506c7187c702b61ff5bc5f",
    authors: [
      {
        pseudSha: "df1274889d164eda3e737cddfe9728e5d9f3a2f82adbdef60b733f18fb07bdfb",
        userSha: "df1274889d164eda3e737cddfe9728e5d9f3a2f82adbdef60b733f18fb07bdfb",
      },
    ],
    rating: "Teen And Up Audiences",
    fandomShas: ["e36f115824ce9e384cac802042927e23fbf2238b1a4a53a7180b51419d935a0e"],
    relationships: 1,
    characters: 4,
    freeforms: 4,
    words: 5850,
    published: "2017-10-03",
    opening: {
      offset: 27,
      length: 28,
      sha: "40e59a71ec7ab274e9de9b6e7a8cdf2beebc633d272be44cf5f0d7ceebd81995",
    },
  },
  "cat-nap.epub": {
    workIdSha: "3f16ad404835a9de38db89fd9190fda0d732b3dcb05fad4c16e26d0c583d31a9",
    titleSha: "40fd4f7644eef5f9474e6edec4b40ec18d62de7ef9bb5ccc8d6932f949c32a10",
    authors: [
      {
        pseudSha: "e591c99d206b729d9fee6b781ffc1a45998baac86a9a12612c8cb98c3255d042",
        userSha: "e591c99d206b729d9fee6b781ffc1a45998baac86a9a12612c8cb98c3255d042",
      },
    ],
    rating: "General Audiences",
    fandomShas: ["9f036a57831e8cf944e5b7b119ed7b8441a5e2b8d0f7efbc24d0b5335118f8a3"],
    relationships: 2,
    relationshipIncludesSha: "70033debd6545bde5afdc37dde1e81cca0c7870ad2d4d4c21d1047954868a085",
    characters: 3,
    freeforms: 6,
    words: 3877,
    published: "2018-12-15",
    opening: {
      offset: 38,
      length: 21,
      sha: "69c1c314d7aa4df26803a3dfa488b96f251ddd3dc4c19fbc1593a33cae255c00",
    },
  },
};

async function shas(values: string[]): Promise<string[]> {
  return Promise.all(values.map(sha256));
}

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
      expect(await sha256(w.ao3WorkId)).toBe(want.workIdSha);
      expect(await sha256(w.title)).toBe(want.titleSha);
      expect(
        await Promise.all(
          w.authors.map(async (a) => ({
            pseudSha: await sha256(a.pseud),
            userSha: a.user === null ? null : await sha256(a.user),
          })),
        ),
      ).toEqual(want.authors);
      expect(w.rating).toBe(want.rating);
      expect(w.warnings).toEqual(["No Archive Warnings Apply"]);
      expect(w.categories).toEqual(["M/M"]);
      expect(await shas(w.fandoms)).toEqual(want.fandomShas);
      expect(w.relationships).toHaveLength(want.relationships);
      if (want.relationshipIncludesSha) {
        expect(await shas(w.relationships)).toContain(want.relationshipIncludesSha);
      }
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
      expect(await sha256(chapter!.title)).toBe(want.titleSha);
      expect(chapter!.html.length).toBeGreaterThan(1000);
      const { offset, length, sha } = want.opening;
      const collapsed = chapter!.html.replace(/\s+/g, " ");
      expect(await sha256(collapsed.slice(offset, offset + length))).toBe(sha);
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
