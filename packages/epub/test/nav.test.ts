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
  /** The preface's Stats line. */
  stats?: string;
}

/** Turns an `ao3Epub()` into an EPUB3 file whose table of contents is `nav`. */
function epub3(nav: string, opts: Epub3Options = {}): Uint8Array {
  const navPath = opts.navPath ?? "nav.xhtml";
  const { mimetype: _, ...entries } = unzipSync(
    ao3Epub({
      title: "Nav Parts",
      stats: opts.stats ?? "Published: 2020-01-01 Chapters: 3/3 Words: 4",
      files,
      navPoints: opts.ncx,
    }),
  );
  const navItem = `<item id="nav" href="${encodeURI(navPath)}" properties="nav" media-type="application/xhtml+xml"/>`;
  let opf = strFromU8(entries["content.opf"]!).replace('version="2.0"', 'version="3.0"');
  if (opts.keepNcx) {
    opf = opf.replace("<manifest>", `<manifest>\n    ${navItem}`);
  } else {
    opf = opf.replace(/<item id="ncx"[^>]*\/>/, navItem).replace('<spine toc="ncx">', "<spine>");
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
      expect(work.chapters.map((c) => markers(c.html))).toEqual([
        ["c1-a"],
        ["c2-a", "c2-b"],
        ["c3-a"],
      ]);
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
      const work = await processEpub(
        epub3(navDoc(tocNav(flatItems("../"))), { navPath: "text/nav.xhtml" }),
      );
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

    it("takes the table of contents from the nav when the NCX lists nothing", async () => {
      const entries = unzipSync(epub3(navDoc(tocNav(flatItems())), { keepNcx: true }));
      const ncx = strFromU8(entries["toc.ncx"]!).replace(
        /<navMap>[\s\S]*<\/navMap>/,
        "<navMap></navMap>",
      );
      const { mimetype: _, ...rest } = entries;
      const work = await processEpub(zipEntries({ ...rest, "toc.ncx": ncx }));
      expect(work.chapters.map((c) => [c.n, c.title])).toEqual([
        [1, "Nav first"],
        [2, "Nav second"],
        [3, "Nav third"],
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
      const opf = strFromU8(entries["content.opf"]!).replace(
        "<spine>",
        '<spine>\n    <itemref idref="nav" linear="no"/>',
      );
      const { mimetype: _, ...rest } = entries;
      const work = await processEpub(zipEntries({ ...rest, "content.opf": opf }));
      expect(work.chapters.map((c) => [c.n, c.title])).toEqual([
        [1, "Nav first"],
        [2, "Nav second"],
        [3, "Nav third"],
      ]);
      expect(work.reviewReasons).toEqual([]);
    });

    it("reads same-document nav links when the nav is in the spine and holds a chapter", async () => {
      const nav = navDoc(`${tocNav(`<li><a href="#n0">Nav zero</a></li>\n${flatItems()}`)}
<div id="chapters"><div class="meta"><h2 class="toc-heading" id="n0">Zero</h2></div>
<div class="userstuff2"><p>marker-c0-a</p></div></div>`);
      const entries = unzipSync(
        epub3(nav, { stats: "Published: 2020-01-01 Chapters: 4/4 Words: 5" }),
      );
      const opf = strFromU8(entries["content.opf"]!).replace(
        "<spine>",
        '<spine>\n    <itemref idref="nav"/>',
      );
      const { mimetype: _, ...rest } = entries;
      const work = await processEpub(zipEntries({ ...rest, "content.opf": opf }));
      expect(work.chapters.map((c) => [c.n, c.title])).toEqual([
        [1, "Nav zero"],
        [2, "Nav first"],
        [3, "Nav second"],
        [4, "Nav third"],
      ]);
      expect(work.chapters.map((c) => markers(c.html))).toEqual([
        ["c0-a"],
        ["c1-a"],
        ["c2-a", "c2-b"],
        ["c3-a"],
      ]);
      expect(work.reviewReasons).toEqual([]);
    });
  });
});

// A nav outside the spine is parsed by the package reader, not the XHTML
// parser, so it must meet the same node budget and depth cap on its own.
describe("hostile nav documents", () => {
  const bareNav = (inner: string) =>
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>${inner}</body></html>`;

  it("rejects a nav outside the spine that takes the documents past the node budget as too_large", async () => {
    // 7 nodes of frame plus 3 per entry: 299,977 nodes, under the 300,000
    // budget alone, over it with the spine documents.
    const entry = `<li><a href="Nav%20Parts_split_000.xhtml">x</a></li>`;
    const nav = bareNav(`<nav epub:type="toc"><ol>${entry.repeat(99_990)}</ol></nav>`);
    await expectEpubError(processEpub(epub3(nav)), "too_large");
  });

  it.each([
    ["names starting with _ or a non-ASCII letter", "<_x/><é/>"],
    ["CDATA sections", "<p><![CDATA[x]]></p>"],
  ])("counts %s against the node budget", async (_, unit) => {
    // Two nodes per unit: 300,002 in all, past the budget on their own.
    const nav = bareNav(
      `<nav epub:type="toc"><ol>${flatItems()}</ol></nav>${unit.repeat(150_001)}`,
    );
    await expectEpubError(processEpub(epub3(nav)), "too_large");
  });

  it("rejects a nav outside the spine nested past the depth cap as parse_failed", async () => {
    const nav = bareNav(`${"<div>".repeat(300)}${tocNav(flatItems())}${"</div>".repeat(300)}`);
    await expectEpubError(processEpub(epub3(nav)), "parse_failed");
  });

  // html > body > divs > nav > ol > li > a: 6 levels besides the divs. The
  // XHTML parser takes 255 levels and rejects 256.
  it("rejects a nav 256 elements deep, as the XHTML parser does", async () => {
    const nav = bareNav(`${"<div>".repeat(250)}${tocNav(flatItems())}${"</div>".repeat(250)}`);
    await expectEpubError(processEpub(epub3(nav)), "parse_failed");
  });

  it("reads a nav nested deep but within the depth cap", async () => {
    const nav = bareNav(`${"<div>".repeat(249)}${tocNav(flatItems())}${"</div>".repeat(249)}`);
    const work = await processEpub(epub3(nav));
    expect(work.chapters.map((c) => c.title)).toEqual(["Nav first", "Nav second", "Nav third"]);
  });

  it("ignores nav links that leave the epub", async () => {
    const hostile = [
      "../../../etc/x.xhtml",
      "/abs.xhtml",
      "http://evil.example/x.xhtml",
      "javascript:alert(1)",
    ]
      .map((href) => `<li><a href="${href}">Hostile</a></li>`)
      .join("\n");
    const work = await processEpub(epub3(navDoc(tocNav(`${hostile}\n${flatItems()}`))));
    expect(work.chapters.map((c) => c.title)).toEqual(["Nav first", "Nav second", "Nav third"]);
    expect(work.reviewReasons).toEqual([]);
  });
});
