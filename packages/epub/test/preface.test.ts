import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { processEpub } from "../src";
import { ao3Epub, zipEntries } from "./helpers";

// Synthetic epubs only: structure, no fanwork text.

/** Rebuilds an epub with `edit` applied to one entry's text. */
function patchEntry(epub: Uint8Array, name: string, edit: (text: string) => string): Uint8Array {
  const entries = unzipSync(epub);
  const patched: Record<string, string | Uint8Array> = {};
  for (const [path, data] of Object.entries(entries)) {
    if (path === "mimetype") continue; // zipEntries writes it again, first
    patched[path] = path === name ? edit(strFromU8(data)) : data;
  }
  return zipEntries(patched);
}

const withOpfElement = (epub: Uint8Array, element: string) =>
  patchEntry(epub, "content.opf", (opf) => opf.replace("</metadata>", `${element}</metadata>`));

describe("06-ao3-preface-and-chapters", () => {
  it("OPF work URL matching the preface is accepted", async () => {
    const id = `<dc:identifier>http://archiveofourown.org/works/1000001</dc:identifier>`;
    const source = `<dc:source>https://www.archiveofourown.org/works/1000001</dc:source>`;
    for (const element of [id, source]) {
      const work = await processEpub(withOpfElement(ao3Epub(), element));
      expect(work.ao3WorkId).toBe("1000001");
      expect(work.reviewReasons).toEqual([]);
    }
  });

  it("Fields are matched by label text", async () => {
    // Labels in an order AO3 never uses, with plural and upper-case variants.
    const extraDl = `<dt>CHARACTERS:</dt><dd><a href="http://archiveofourown.org/tags/1">Char One</a>, <a href="http://archiveofourown.org/tags/2">Char Two</a></dd>
    <dt>Category:</dt><dd><a href="http://archiveofourown.org/tags/3">F/M</a>, <a href="http://archiveofourown.org/tags/4">Gen</a></dd>
    <dt>Relationships:</dt><dd><a href="http://archiveofourown.org/tags/5">Char One/Char Two</a></dd>
    <dt>Series:</dt><dd>Part 3 of <a href="http://archiveofourown.org/series/7">Some Series</a></dd>`;
    const work = await processEpub(ao3Epub({ extraDl, stats: "Published: 2020-01-02 Words: 12" }));
    expect(work.rating).toBe("General Audiences");
    expect(work.warnings).toEqual(["No Archive Warnings Apply"]);
    expect(work.categories).toEqual(["F/M", "Gen"]);
    expect(work.fandoms).toEqual(["Test Fandom"]);
    expect(work.relationships).toEqual(["Char One/Char Two"]);
    expect(work.characters).toEqual(["Char One", "Char Two"]);
    expect(work.freeforms).toEqual(["Tag A", "Tag & B"]);
    expect(work.language).toBe("English");
    expect(work.series).toEqual([{ name: "Some Series", part: 3, ao3SeriesId: "7" }]);
    expect(work.stats.published).toBe("2020-01-02");
    expect(work.stats.words).toBe(12);
    expect(work.rawMeta).toEqual({});
    expect(work.reviewReasons).toEqual([]);
  });

  it("Renamed CSS classes do not break parsing", async () => {
    const extraDl = `<dt>Category:</dt><dd><a href="http://archiveofourown.org/tags/3">F/M</a></dd>
    <dt>Relationship:</dt><dd><a href="http://archiveofourown.org/tags/5">Char One/Char Two</a></dd>
    <dt>Character:</dt><dd><a href="http://archiveofourown.org/tags/1">Char One</a></dd>
    <dt>Series:</dt><dd>Part 3 of <a href="http://archiveofourown.org/series/7">Some Series</a></dd>`;
    const original = ao3Epub({ extraDl, stats: "Published: 2020-01-02 Chapters: 1/1 Words: 12" });
    // Every class value in the preface file becomes a Calibre-style name; ids and rel stay.
    let n = 0;
    const renamed = patchEntry(original, "Synthetic_preface.xhtml", (x) => x.replace(/class="[^"]*"/g, () => `class="calibre_x${n++}"`));
    expect(n).toBeGreaterThan(10);
    expect(strFromU8(unzipSync(renamed)["Synthetic_preface.xhtml"]!)).not.toMatch(/class="(tags|byline|userstuff|endnote-link)"/);

    const before = await processEpub(original);
    const after = await processEpub(renamed);
    expect(after).toEqual(before);
    expect(after.relationships).toEqual(["Char One/Char Two"]);
    expect(after.authors).toEqual([{ pseud: "someone", user: "someone" }]);
  });

  it("Summary, notes and end notes come from headed blocks", async () => {
    const work = await processEpub(
      ao3Epub({
        summary: `<p>marker-summary</p><blockquote><p>marker-decoy-nested</p></blockquote>`,
        notes: `<p>marker-notes</p>`,
        endNotes: `<p>marker-end</p>`,
      }),
    );
    expect(work.summaryHtml).toContain("marker-summary");
    expect(work.notesHtml).toBe("<p>marker-notes</p>");
    expect(work.endNotesHtml).toBe("<p>marker-end</p>");
    for (const html of [work.summaryHtml, work.notesHtml, work.endNotesHtml]) {
      expect(html).not.toMatch(/See the end of the work/);
      expect(html).not.toMatch(/drop by the archive/);
    }
    expect(work.notesHtml).not.toContain("marker-decoy");
    expect(work.endNotesHtml).not.toContain("marker-notes");
  });

  it("Parser output is deterministic", async () => {
    const epubs = [
      ao3Epub(),
      ao3Epub({ extraDl: `<dt>Series:</dt><dd>Part 1 of <a href="http://archiveofourown.org/series/9">S</a></dd><dt>Odd:</dt><dd>x</dd>` }),
      ao3Epub({ stats: "Chapters: 1/1" }),
      ao3Epub({
        files: [
          { name: "A.xhtml", body: `<div id="chapters"><p>marker-a</p></div>` },
          { name: "B.xhtml", body: `<div id="chapters"><p>marker-b</p></div>` },
        ],
        navPoints: [],
        stats: "Chapters: 2/2",
      }),
    ];
    for (const epub of epubs) {
      const first = await processEpub(epub.slice());
      const second = await processEpub(epub.slice());
      expect(second).toEqual(first);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });
});
