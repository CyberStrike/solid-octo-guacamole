import { describe, expect, it } from "vitest";
import { processEpub } from "../src";
import { ao3Epub } from "./helpers";

// Full-output snapshots of synthetic fixtures (ARCHITECTURE: "a fixture's output
// can be snapshotted"). The real AO3 fixtures are fanworks and stay out of the
// repo, so they are checked field by field in fixtures.test.ts instead.
// A changed snapshot must be listed in the PR with the reason.

describe("output snapshots", () => {
  it("synthetic baseline", async () => {
    expect(await processEpub(ao3Epub())).toMatchSnapshot();
  });

  it("two chapters over two files, with notes, series and markup", async () => {
    const work = await processEpub(
      ao3Epub({
        title: "Two Parts",
        stats: "Published: 2021-05-06 Updated: 2021-06-07 Chapters: 2/? Words: 20",
        notes: `<p>Opening <em>notes</em> with <a href="https://example.org/a?b=1&amp;c=2">a link</a>.</p>`,
        endNotes: `<p>Thanks &amp; goodbye&hellip;</p>`,
        extraDl: `<dt>Series:</dt><dd>Part 1 of <a href="http://archiveofourown.org/series/7">Some Series</a></dd>`,
        files: [
          {
            name: "Two Parts_split_000.xhtml",
            body: `<div id="chapters" class="userstuff1"><h2 class="toc-heading" id="t1">First</h2>
<div class="userstuff2"><p class="calibre7">One <strong>two</strong><br class="calibre1"/>three.</p><hr/>
<blockquote><p>Quoted.</p></blockquote></div>
<h2 class="toc-heading" id="t2">Second</h2><div class="userstuff2"><p>Second starts here.</p></div></div>`,
          },
          {
            name: "Two Parts_split_001.xhtml",
            body: `<div id="chapters" class="userstuff1"><div class="userstuff2"><ul><li>a</li><li>b</li></ul>
<table><tr><td colspan="2" style="x">cell</td></tr></table><p dir="rtl" lang="ar">نص</p></div></div>`,
          },
        ],
        navPoints: [
          { label: "1. First", src: "Two%20Parts_split_000.xhtml#t1" },
          { label: "2. Second", src: "Two%20Parts_split_000.xhtml#t2" },
        ],
      }),
    );
    expect(work.reviewReasons).toEqual([]);
    expect(work).toMatchSnapshot();
  });
});
