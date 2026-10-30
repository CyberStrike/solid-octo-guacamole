import { describe, expect, it } from "vitest";
import { processEpub } from "../src";
import { numberTree, parseHtml } from "../src/dom";
import { parsePreface } from "../src/preface";
import { ao3Epub, type Ao3Spec, type SpineFile } from "./helpers";

// Three chapters over three size-split files:
//   file 0: chapter 1, then chapter 2 starting mid-file at #toc2
//   file 1: rest of chapter 2, then chapter 3 starting at #toc3
//   file 2: rest of chapter 3
const files: SpineFile[] = [
  {
    name: "Three Parts_split_000.xhtml",
    body: `<div id="chapters" class="userstuff1">
  <div class="meta"><h2 class="toc-heading" id="toc1">One</h2><p>Chapter Notes</p><blockquote><p>marker-c1-notes</p></blockquote></div>
  <div class="userstuff2"><p>marker-c1-a</p></div>
  <div class="meta"><h2 class="toc-heading" id="toc2">Two</h2></div>
  <div class="userstuff2"><p>marker-c2-a</p></div>
</div>`,
  },
  {
    name: "Three Parts_split_001.xhtml",
    body: `<div id="chapters" class="userstuff1">
  <div class="userstuff2"><p>marker-c2-b</p></div>
  <div class="meta"><h2 class="toc-heading" id="toc3">Three</h2></div>
  <div class="userstuff2"><p>marker-c3-a</p></div>
</div>`,
  },
  {
    name: "Three Parts_split_002.xhtml",
    body: `<div id="chapters" class="userstuff1">
  <div class="userstuff2"><p>marker-c3-b</p></div>
</div>
<div id="afterword"><div class="calibre8"></div></div>`,
  },
];

const navPoints = [
  { label: "1. One", src: "Three%20Parts_split_000.xhtml" },
  { label: "2. Two", src: "Three%20Parts_split_000.xhtml#toc2" },
  { label: "3. Three", src: "Three%20Parts_split_001.xhtml#toc3" },
];

const spec = (stats: string, extra: Partial<Ao3Spec> = {}): Ao3Spec => ({
  title: "Three Parts",
  stats,
  files,
  navPoints,
  extraDl: `<dt>Series:</dt><dd>Part 2 of <a href="http://archiveofourown.org/series/42">A Series</a></dd>
    <dt>Collections:</dt><dd>Some Collection</dd>`,
  ...extra,
});

const markers = (html: string) => [...html.matchAll(/marker-(c\d-\w+)/g)].map((m) => m[1]);

describe("chapter boundaries", () => {
  it("splits at NCX anchors, across files", async () => {
    const work = await processEpub(ao3Epub(spec("Published: 2020-01-01 Updated: 2020-03-01 Chapters: 3/3 Words: 9")));
    expect(work.chapters.map((c) => [c.n, c.title])).toEqual([
      [1, "1. One"],
      [2, "2. Two"],
      [3, "3. Three"],
    ]);
    expect(work.chapters.map((c) => markers(c.html))).toEqual([
      ["c1-notes", "c1-a"],
      ["c2-a", "c2-b"],
      ["c3-a", "c3-b"],
    ]);
    for (const c of work.chapters) expect(c.html).not.toMatch(/<h2/);
    expect(work.stats).toEqual({
      published: "2020-01-01",
      updated: "2020-03-01",
      completed: null,
      words: 9,
      chapters: { posted: 3, total: 3 },
    });
    expect(work.reviewReasons).toEqual([]);
  });

  it("flags a chapter count that disagrees with Stats", async () => {
    const work = await processEpub(ao3Epub(spec("Published: 2020-01-01 Chapters: 2/3 Words: 9")));
    expect(work.chapters).toHaveLength(3);
    expect(work.stats.chapters).toEqual({ posted: 2, total: 3 });
    expect(work.reviewReasons).toHaveLength(1);
    expect(work.reviewReasons[0]).toMatch(/^chapter_count_mismatch/);
  });

  it("reads Series and keeps unknown labels in rawMeta", async () => {
    const work = await processEpub(ao3Epub(spec("Published: 2020-01-01 Chapters: 3/? Words: 9")));
    expect(work.series).toEqual([{ name: "A Series", part: 2, ao3SeriesId: "42" }]);
    expect(work.rawMeta).toEqual({ Collections: "Some Collection" });
    expect(work.stats.chapters).toEqual({ posted: 3, total: null });
    expect(work.freeforms).toEqual(["Tag A", "Tag & B"]);
  });

  it("falls back to chapter headings without a usable TOC", async () => {
    const work = await processEpub(ao3Epub(spec("Chapters: 3/3", { navPoints: [] })));
    expect(work.chapters.map((c) => c.title)).toEqual(["One", "Two", "Three"]);
    expect(work.chapters.map((c) => markers(c.html))).toEqual([
      ["c1-notes", "c1-a"],
      ["c2-a", "c2-b"],
      ["c3-a", "c3-b"],
    ]);
    expect(work.reviewReasons).toEqual([]);
  });

  it("falls back to one chapter per file, flagged for review", async () => {
    const plain = files.map((f) => ({ ...f, body: f.body.replace(/ class="toc-heading"/g, "") }));
    const work = await processEpub(ao3Epub(spec("Chapters: 3/3", { navPoints: [], files: plain })));
    expect(work.chapters).toHaveLength(3);
    expect(work.chapters.map((c) => markers(c.html))).toEqual([
      ["c1-notes", "c1-a", "c2-a"],
      ["c2-b", "c3-a"],
      ["c3-b"],
    ]);
    expect(work.reviewReasons).toEqual([expect.stringMatching(/^chapters_one_per_file/)]);
  });

  it("falls back to headings when a TOC anchor does not resolve", async () => {
    const broken = [navPoints[0]!, { ...navPoints[1]!, src: "Three%20Parts_split_000.xhtml#nowhere" }, navPoints[2]!];
    const work = await processEpub(ao3Epub(spec("Chapters: 3/3", { navPoints: broken })));
    expect(work.chapters.map((c) => c.title)).toEqual(["One", "Two", "Three"]);
    expect(work.reviewReasons).toEqual([]);
  });

  it("flags text before the first chapter start", async () => {
    const lead = files.map((f, i) => (i === 0 ? { ...f, body: f.body.replace(`<div class="meta">`, `<p>marker-c0-lead</p><div class="meta">`) } : f));
    const anchored = [{ ...navPoints[0]!, src: "Three%20Parts_split_000.xhtml#toc1" }, navPoints[1]!, navPoints[2]!];
    const work = await processEpub(ao3Epub(spec("Chapters: 3/3", { files: lead, navPoints: anchored })));
    expect(work.chapters).toHaveLength(3);
    expect(work.reviewReasons).toEqual([expect.stringMatching(/^content_before_first_chapter/)]);
  });

  it("flags a spine file between chapters that has no #chapters region", async () => {
    const orphan = { name: "Three Parts_split_000b.xhtml", body: `<div class="userstuff2"><p>marker-cx-orphan</p></div>` };
    const work = await processEpub(ao3Epub(spec("Chapters: 3/3", { files: [files[0]!, orphan, files[1]!, files[2]!] })));
    expect(work.chapters).toHaveLength(3);
    expect(work.reviewReasons).toEqual(["content_outside_chapters: Three Parts_split_000b.xhtml"]);
  });
});

describe("preface labels and entities", () => {
  it("keeps labels that collide with Object.prototype names in rawMeta", async () => {
    const work = await processEpub(
      ao3Epub({ extraDl: `<dt>Constructor:</dt><dd>one</dd><dt>__proto__:</dt><dd>two</dd><dt>toString:</dt><dd>three</dd>` }),
    );
    expect(Object.getPrototypeOf(work.rawMeta)).toBe(Object.prototype);
    expect(Object.entries(work.rawMeta)).toEqual([
      ["Constructor", "one"],
      ["__proto__", "two"],
      ["toString", "three"],
    ]);
  });

  it("decodes XHTML named entities in tags", async () => {
    const work = await processEpub(
      ao3Epub({ extraDl: `<dt>Characters:</dt><dd><a href="http://archiveofourown.org/tags/c">Ren&eacute;e &Omega; &euro;</a></dd>` }),
    );
    expect(work.characters).toEqual(["Renée Ω €"]);
  });

  it("finds the posted-originally work URL directly inside a large preface element", async () => {
    const root = await parseHtml(`<div id="preface"><blockquote><a href="http://archiveofourown.org/works/99">inspired by</a></blockquote>
Posted originally on the <a href="http://archiveofourown.org/">Archive of Our Own</a> at
<a href="http://archiveofourown.org/works/77">http://archiveofourown.org/works/77</a>.
<p>${"long notes ".repeat(1_000)}</p></div>`);
    numberTree(root, 0);
    expect(parsePreface([root]).workId).toBe("77");
  });
});

describe("06-ao3-preface-and-chapters", () => {
  it("Chapter boundaries from table-of-contents anchors", async () => {
    // A heading that looks like a chapter start but has no TOC anchor stays content.
    const extra = files.map((f, i) =>
      i === 0 ? { ...f, body: f.body.replace(`<p>marker-c2-a</p>`, `<p>marker-c2-a</p><h2 class="toc-heading" id="extra">Aside</h2><p>marker-c2-aside</p>`) } : f,
    );
    const work = await processEpub(ao3Epub(spec("Chapters: 3/3", { files: extra })));
    expect(work.chapters.map((c) => c.title)).toEqual(["1. One", "2. Two", "3. Three"]);
    expect(work.chapters.map((c) => markers(c.html))).toEqual([
      ["c1-notes", "c1-a"],
      ["c2-a", "c2-aside", "c2-b"],
      ["c3-a", "c3-b"],
    ]);
    expect(work.chapters[1]!.html).toContain("Aside");
    expect(work.reviewReasons).toEqual([]);
  });

  it("One file holding several chapters is split by anchors", async () => {
    const one: SpineFile[] = [
      {
        name: "Single.xhtml",
        body: `<div id="chapters"><h2 class="toc-heading" id="a1">First</h2><p>marker-c1-a</p><h2 class="toc-heading" id="a2">Second</h2><p>marker-c2-a</p></div>`,
      },
    ];
    const nav = [
      { label: "1. First", src: "Single.xhtml#a1" },
      { label: "2. Second", src: "Single.xhtml#a2" },
    ];
    const work = await processEpub(ao3Epub({ files: one, navPoints: nav, stats: "Chapters: 2/2" }));
    expect(work.chapters.map((c) => c.title)).toEqual(["1. First", "2. Second"]);
    expect(work.chapters.map((c) => markers(c.html))).toEqual([["c1-a"], ["c2-a"]]);
    expect(work.reviewReasons).toEqual([]);
  });

  it("Chapter headings are used when the table of contents is missing", async () => {
    const work = await processEpub(ao3Epub(spec("Chapters: 3/3", { navPoints: [] })));
    expect(work.chapters.map((c) => c.title)).toEqual(["One", "Two", "Three"]);
    expect(work.reviewReasons).toEqual([]);
    const broken = [navPoints[0]!, { ...navPoints[1]!, src: "Three%20Parts_split_000.xhtml#nowhere" }, navPoints[2]!];
    const mismatched = await processEpub(ao3Epub(spec("Chapters: 3/3", { navPoints: broken })));
    expect(mismatched.chapters.map((c) => c.title)).toEqual(["One", "Two", "Three"]);
    expect(mismatched.reviewReasons).toEqual([]);
  });
});
