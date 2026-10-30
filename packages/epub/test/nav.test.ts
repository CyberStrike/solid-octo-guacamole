import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { processEpub } from "../src";
import { ao3Epub, expectEpubError, type SpineFile, zipEntries } from "./helpers";

// Three chapters over two files, as chapters.test.ts builds them. The nav
// labels differ from the headings, so the heading fallback can't pass for
// the nav.
const files: SpineFile[] = [
  {
    name: "Nav Parts_split_000.xhtml",
    body: `<div id="chapters" class="userstuff1">
  <div class="meta"><h2 class="toc-heading" id="toc1">One</h2></div>
  <div class="userstuff2"><p>marker-c1-a</p></div>
  <div class="meta"><h2 class="toc-heading" id="toc2">Two</h2></div>
  <div class="userstuff2"><p>marker-c2-a</p></div>
</div>`,
  },
  {
    name: "Nav Parts_split_001.xhtml",
    body: `<div id="chapters" class="userstuff1">
  <div class="userstuff2"><p>marker-c2-b</p></div>
  <div class="meta"><h2 class="toc-heading" id="toc3">Three</h2></div>
  <div class="userstuff2"><p>marker-c3-a</p></div>
</div>`,
  },
];

const navDoc = (navs: string) => `<?xml version='1.0' encoding='utf-8'?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
  <head><title>Contents</title></head>
  <body>
${navs}
  </body>
</html>`;

const tocNav = (items: string) => `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${items}
</ol></nav>`;

const flatItems = (prefix = "") => `<li><a href="${prefix}Synthetic_preface.xhtml">Preface</a></li>
<li><a href="${prefix}Nav%20Parts_split_000.xhtml">Nav first</a></li>
<li><a href="${prefix}Nav%20Parts_split_000.xhtml#toc2">Nav second</a></li>
<li><a href="${prefix}Nav%20Parts_split_001.xhtml#toc3">Nav third</a></li>
<li><a href="${prefix}Synthetic_afterword.xhtml">Afterword</a></li>`;

interface Epub3Options {
  /** Where the nav document lives in the zip; its manifest href is relative to the OPF at the root. */
  navPath?: string;
  /** Keep the generated `toc.ncx` and its manifest item. */
  keepNcx?: boolean;
  /** NCX entries for chapters, as `ao3Epub`'s `navPoints`. */
  ncx?: { label: string; src: string }[];
}

/** Turns an `ao3Epub()` into an EPUB3 file whose table of contents is `nav`. */
function epub3(nav: string, opts: Epub3Options = {}): Uint8Array {
  const navPath = opts.navPath ?? "nav.xhtml";
  const { mimetype: _, ...entries } = unzipSync(
    ao3Epub({ title: "Nav Parts", stats: "Published: 2020-01-01 Chapters: 3/3 Words: 4", files, navPoints: opts.ncx }),
  );
  const navItem = `<item id="nav" href="${encodeURI(navPath)}" properties="nav" media-type="application/xhtml+xml"/>`;
  let opf = strFromU8(entries["content.opf"]!).replace('version="2.0"', 'version="3.0"');
  if (opts.keepNcx) {
    opf = opf.replace("<manifest>", `<manifest>\n    ${navItem}`);
  } else {
    opf = opf
      .replace(/<item id="ncx"[^>]*\/>/, navItem)
      .replace('<spine toc="ncx">', "<spine>");
    delete entries["toc.ncx"];
  }
  return zipEntries({ ...entries, "content.opf": opf, [navPath]: nav });
}

const markers = (html: string) => [...html.matchAll(/marker-(c\d-\w+)/g)].map((m) => m[1]);

describe("06 AO3 preface and chapters", () => {
  describe("OPF is found through container.xml", () => {
    it("takes the table of contents from an EPUB3 nav when there is no NCX", async () => {
      const work = await processEpub(epub3(navDoc(tocNav(flatItems()))));
      expect(work.chapters.map((c) => [c.n, c.title])).toEqual([
        [1, "Nav first"],
        [2, "Nav second"],
        [3, "Nav third"],
      ]);
      expect(work.chapters.map((c) => markers(c.html))).toEqual([["c1-a"], ["c2-a", "c2-b"], ["c3-a"]]);
      expect(work.reviewReasons).toEqual([]);
    });

    it("reads nested nav entries under a span group heading", async () => {
      const items = `<li><a href="Synthetic_preface.xhtml">Preface</a></li>
<li><span>Part one</span><ol>
  <li><a href="Nav%20Parts_split_000.xhtml"><span>1.</span> Nav first</a></li>
  <li><a href="Nav%20Parts_split_000.xhtml#toc2">Nav second</a><ol>
    <li><a href="Nav%20Parts_split_001.xhtml#toc3">Nav third</a></li>
  </ol></li>
</ol></li>`;
      const work = await processEpub(epub3(navDoc(tocNav(items))));
      expect(work.chapters.map((c) => [c.n, c.title])).toEqual([
        [1, "1. Nav first"],
        [2, "Nav second"],
        [3, "Nav third"],
      ]);
      expect(work.reviewReasons).toEqual([]);
    });

    it("uses only the toc nav when a landmarks nav comes first", async () => {
      const landmarks = `<nav epub:type="landmarks"><ol>
<li><a epub:type="bodymatter" href="Nav%20Parts_split_001.xhtml#toc3">Landmark start</a></li>
</ol></nav>`;
      const work = await processEpub(epub3(navDoc(`${landmarks}\n${tocNav(flatItems())}`)));
      expect(work.chapters.map((c) => [c.n, c.title])).toEqual([
        [1, "Nav first"],
        [2, "Nav second"],
        [3, "Nav third"],
      ]);
      expect(work.reviewReasons).toEqual([]);
    });

    it("resolves nav hrefs against the nav document's directory", async () => {
      const work = await processEpub(epub3(navDoc(tocNav(flatItems("../"))), { navPath: "text/nav.xhtml" }));
      expect(work.chapters.map((c) => [c.n, c.title])).toEqual([
        [1, "Nav first"],
        [2, "Nav second"],
        [3, "Nav third"],
      ]);
      expect(work.reviewReasons).toEqual([]);
    });

    it("falls back to headings when the nav has no toc and there is no NCX", async () => {
      const landmarksOnly = `<nav epub:type="landmarks"><ol>
<li><a epub:type="bodymatter" href="Nav%20Parts_split_000.xhtml">Landmark start</a></li>
</ol></nav>`;
      const work = await processEpub(epub3(navDoc(landmarksOnly)));
      expect(work.chapters.map((c) => [c.n, c.title])).toEqual([
        [1, "One"],
        [2, "Two"],
        [3, "Three"],
      ]);
      expect(work.reviewReasons).toEqual([]);
    });

    it("takes the table of contents from the NCX when there is both an NCX and a nav", async () => {
      const ncx = [
        { label: "NCX first", src: "Nav%20Parts_split_000.xhtml" },
        { label: "NCX second", src: "Nav%20Parts_split_000.xhtml#toc2" },
        { label: "NCX third", src: "Nav%20Parts_split_001.xhtml#toc3" },
      ];
      const work = await processEpub(epub3(navDoc(tocNav(flatItems())), { keepNcx: true, ncx }));
      expect(work.chapters.map((c) => [c.n, c.title])).toEqual([
        [1, "NCX first"],
        [2, "NCX second"],
        [3, "NCX third"],
      ]);
      expect(work.reviewReasons).toEqual([]);
    });

    it("rejects a nav that declares XML entities as not_epub", async () => {
      const nav = navDoc(tocNav(flatItems())).replace(
        "<!DOCTYPE html>",
        '<!DOCTYPE html [<!ENTITY chapter "Nav first">]>',
      );
      await expectEpubError(processEpub(epub3(nav)), "not_epub");
    });

    it("reads the nav when it is also in the spine", async () => {
      const entries = unzipSync(epub3(navDoc(tocNav(flatItems()))));
      const opf = strFromU8(entries["content.opf"]!).replace("<spine>", '<spine>\n    <itemref idref="nav" linear="no"/>');
      const { mimetype: _, ...rest } = entries;
      const work = await processEpub(zipEntries({ ...rest, "content.opf": opf }));
      expect(work.chapters.map((c) => [c.n, c.title])).toEqual([
        [1, "Nav first"],
        [2, "Nav second"],
        [3, "Nav third"],
      ]);
      expect(work.reviewReasons).toEqual([]);
    });
  });
});
