import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { processEpub, type ImageRef } from "../src";
import { ao3Epub, fromBase64, MiB } from "./helpers";

// The sanitizer and image cases of specs/scenarios/mvp/07-sanitizing-and-images.md that issue #39 lists, through processEpub.
// Chapter-link rewriting, content-origin image keys, signature sniffing of JPEG/GIF/WebP and key sharing live elsewhere or are tracked as issues.

const PNG = fromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
);
const IMAGE_BASE = "https://content.example/img/";
const PNG_MANIFEST = { href: "images/p.png", mediaType: "image/png", data: PNG };
const LINK = "https://example.org/";

type Extra = { href: string; mediaType: string; data: Uint8Array };

/** A chapter body: the leading heading is the chapter title, which the parser removes. */
const chapterOf = (inner: string) =>
  `<div id="chapters"><h2 class="toc-heading">T</h2><div>${inner}</div></div>`;
const epubOf = (inner: string, extraManifest: Extra[] = []) =>
  ao3Epub({ files: [{ name: "x_split_001.xhtml", body: chapterOf(inner) }], extraManifest });

async function chapterHtml(inner: string, extraManifest: Extra[] = []) {
  const work = await processEpub(epubOf(inner, extraManifest), { imageBase: IMAGE_BASE });
  expect(work.chapters).toHaveLength(1);
  return work.chapters[0]!.html;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function pngOfSize(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(PNG.subarray(0, 8)); // signature only: the checks look at the signature and the size
  return bytes;
}

describe("07-sanitizing-and-images", () => {
  it("Allowlisted elements are kept", async () => {
    const html = await chapterHtml(
      `<p>alpha<br/>beta</p><hr/>
<p><em>e</em><strong>s</strong><i>i</i><b>b</b><u>u</u><s>s</s>x<sub>sub</sub><sup>sup</sup><abbr title="t">ab</abbr><small>sm</small></p>
<blockquote><p>quote</p></blockquote>
<h1>h1</h1><h2>h2</h2><h3>h3</h3><h4>h4</h4><h5>h5</h5><h6>h6</h6>
<ul><li>u1</li></ul><ol><li>o1</li></ol>
<dl><dt>term</dt><dd>def</dd></dl>
<table><thead><tr><th>head</th></tr></thead><tbody><tr><td>cell</td></tr></tbody></table>
<p><span lang="en">span-text</span></p><div lang="en">div-text</div>
<p><a href="${LINK}">link-text</a></p><p><img src="images/p.png" alt="pic"/></p>
<center>centered</center>`,
      [PNG_MANIFEST],
    );

    expect(html).toContain(`<div lang="en">div-text</div>`);
    expect(html).toContain(`<span lang="en">span-text</span>`);
    for (const tag of [
      "p",
      "br",
      "hr",
      "em",
      "strong",
      "i",
      "b",
      "u",
      "s",
      "sub",
      "sup",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "dl",
      "dt",
      "dd",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "span",
      "div",
      "a",
      "img",
      "abbr",
      "small",
      "center",
    ]) {
      expect(html, tag).toMatch(new RegExp(`<${tag}[\\s>]`));
    }
  });

  it("Empty marker spans and divs are dropped", async () => {
    const html = await chapterHtml(
      `<p>keep-1</p><div> </div><div></div><p>keep-2 <span>plain-span</span></p>`,
    );
    const inside = html.replace(/^<div>/, "").replace(/<\/div>$/, ""); // the chapter's own wrapper div has content, so it stays
    expect(inside).not.toContain("<div");
    expect(inside).not.toContain("<span");
    expect(html).toContain("plain-span");
    expect(html).toContain("keep-1");
    expect(html).toContain("keep-2");
  });

  it("Only allowlisted attributes are kept", async () => {
    const extra = `class="c" id="i" data-x="d"`;
    const html = await chapterHtml(
      `<p><a href="${LINK}" title="t1" dir="rtl" lang="en" align="center" ${extra}>link-text</a></p>
<p><img src="images/p.png" alt="alt1" title="t2" ${extra}/></p>
<table><tbody><tr><td colspan="2" rowspan="3" ${extra}>cell</td></tr></tbody></table>
<p title="t3" ${extra}>para</p>`,
      [PNG_MANIFEST],
    );
    expect(html).toMatch(/<a [^>]*title="t1"/);
    expect(html).toMatch(/<a [^>]*dir="rtl"[^>]*lang="en"|<a [^>]*lang="en"[^>]*dir="rtl"/);
    expect(html).toMatch(/<img [^>]*title="t2"/);
    expect(html).toMatch(/<td [^>]*colspan="2"/);
    expect(html).toMatch(/<td [^>]*rowspan="3"/);
    for (const kept of [
      "href=",
      "src=",
      "alt=",
      "title=",
      "colspan=",
      "rowspan=",
      "dir=",
      "lang=",
      "align=",
    ]) {
      expect(html, kept).toContain(` ${kept}`);
    }
    expect(html).not.toMatch(/\sclass=/);
    expect(html).not.toMatch(/\sid=/);
    expect(html).not.toMatch(/data-x/);
  });

  it("Dangerous elements are dropped", async () => {
    // embed is a void element in HTML, so it can hold no content to drop: it goes in empty.
    const tags = ["script", "style", "iframe", "object", "embed", "form", "svg", "math"];
    const body = tags
      .map(
        (tag, n) =>
          `<p>keep-${n}</p>` +
          (tag === "embed"
            ? `<embed src="x.swf"/>`
            : `<${tag}>inner-${n}<b>child-${n}</b><p>para-${n}</p></${tag}>`),
      )
      .join("\n");
    const html = await chapterHtml(body);
    for (const tag of tags) expect(html, tag).not.toMatch(new RegExp(`<${tag}`, "i"));
    expect(html).not.toMatch(/inner-|child-|para-/);
    for (let n = 0; n < tags.length; n++) expect(html).toContain(`keep-${n}`);
  });

  it("Dangerous elements under a namespace prefix are dropped", async () => {
    const html = await chapterHtml(
      `<p>keep-a</p><svg:script>alert(1)</svg:script><p>keep-b</p><html:style>p { display: none }</html:style><p>keep-c</p>`,
    );
    expect(html).not.toMatch(/alert|display|svg:|html:|<script|<style/i);
    for (const k of ["keep-a", "keep-b", "keep-c"]) expect(html).toContain(k);
  });

  it("Event handler attributes are dropped", async () => {
    const html = await chapterHtml(
      `<p onclick="x(1)" onmouseover="x(2)" ONFOCUS="x(3)">para-text</p>
<p><a href="${LINK}" onclick="x(4)" onload="x(5)">link-text</a></p>
<p><img src="images/p.png" alt="pic" onerror="x(6)" onload="x(7)"/></p>`,
      [PNG_MANIFEST],
    );
    expect(html).not.toMatch(/\son\w+\s*=/i);
    expect(html).not.toMatch(/x\(\d\)/);
    expect(html).toContain("para-text");
    expect(html).toContain("link-text");
    expect(html).toContain("<img");
  });

  it("Inline style is dropped", async () => {
    const html = await chapterHtml(
      `<p style="color:red">para-text</p><p><span lang="en" style="display:none">span-text</span></p>
<p><a href="${LINK}" style="position:fixed">link-text</a></p>
<table><tbody><tr><td style="width:1px">cell-text</td></tr></tbody></table>`,
    );
    expect(html).not.toMatch(/style\s*=/i);
    for (const t of ["para-text", "span-text", "link-text", "cell-text"]) expect(html).toContain(t);
  });

  it("Unknown wrapper elements are unwrapped", async () => {
    const html = await chapterHtml(
      `<p>one <custom-box>words <custom-box>nested</custom-box></custom-box> <x:p>prefixed</x:p></p>`,
    );
    expect(html).not.toMatch(/custom-box|<x:|x:p/);
    expect(html).toContain("words nested");
    expect(html).toContain("prefixed");
  });

  it("http and https links are kept with rel attributes", async () => {
    const html = await chapterHtml(
      `<p><a href="https://example.org/">secure-link</a> <a href="http://example.org/plain">plain-link</a></p>`,
    );
    expect(html).toContain(
      `<a href="https://example.org/" rel="nofollow noopener noreferrer ugc">secure-link</a>`,
    );
    expect(html).toContain(
      `<a href="http://example.org/plain" rel="nofollow noopener noreferrer ugc">plain-link</a>`,
    );
  });

  it("Other link schemes are removed", async () => {
    const html = await chapterHtml(
      `<p><a href="javascript:x(1)">text-js</a> <a href="data:text/html,hi">text-data</a> <a href="vbscript:x(2)">text-vb</a> <a href="mailto:someone@example.org">text-mail</a></p>`,
    );
    expect(html).not.toMatch(/javascript|data:|vbscript|mailto|<a[\s>]|href/i);
    for (const t of ["text-js", "text-data", "text-vb", "text-mail"]) expect(html).toContain(t);
  });

  it("Remote images are dropped", async () => {
    const html = await chapterHtml(
      `<p>r-1 <img src="http://remote.example/a.png"/></p><p>r-2 <img src="https://remote.example/b.png"/></p><p>r-3 <img src="//remote.example/c.png"/></p><p>control <img src="images/p.png" alt="ok"/></p>`,
      [PNG_MANIFEST],
    );
    expect(html).not.toContain("remote.example");
    expect(html.match(/<img/g)).toHaveLength(1);
    for (const t of ["r-1", "r-2", "r-3", "control"]) expect(html).toContain(t);
  });

  it("Summary and notes are sanitized too", async () => {
    const payload = (m: string) =>
      `<p>keep-${m}</p><script>x('${m}')</script><p onclick="x('${m}')">onclick-${m}</p><p><a href="javascript:x('${m}')">link-${m}</a></p><style>p{display:none}</style><form><input name="f"/></form><p style="color:red">styled-${m}</p>`;
    const work = await processEpub(
      ao3Epub({ summary: payload("sum"), notes: payload("note"), endNotes: payload("end") }),
    );
    for (const [field, m] of [
      [work.summaryHtml, "sum"],
      [work.notesHtml, "note"],
      [work.endNotesHtml, "end"],
    ] as const) {
      expect(field, m).not.toBeNull();
      expect(field).not.toMatch(
        /<script|<style|<form|<input|<img|<a[\s>]|javascript|style=|\son\w+\s*=|x\('/i,
      );
      expect(field).toContain(`keep-${m}`);
      expect(field).toContain(`link-${m}`);
      expect(field).toContain(`<p>onclick-${m}</p>`);
      expect(field).toContain(`styled-${m}`);
    }
  });

  it("Image with a misleading extension is rejected", async () => {
    const received: ImageRef[] = [];
    const work = await processEpub(
      epubOf(`<p>fake <img src="images/cover.png"/></p><p>real <img src="images/p.png"/></p>`, [
        {
          href: "images/cover.png",
          mediaType: "image/png",
          data: strToU8("<html><body>not an image</body></html>"),
        },
        PNG_MANIFEST,
      ]),
      { imageBase: IMAGE_BASE, onImage: (ref) => void received.push(ref) },
    );
    const html = work.chapters[0]!.html;
    expect(work.images.map((i) => i.sourcePath)).toEqual(["images/p.png"]);
    expect(received.map((r) => r.sourcePath)).toEqual(["images/p.png"]);
    expect(html).not.toContain("cover.png");
    expect(html.match(/<img/g)).toHaveLength(1);
  });

  it("Image of exactly 5 MB is accepted", async () => {
    const big = pngOfSize(5 * MiB);
    const sizes: number[] = [];
    const work = await processEpub(
      epubOf(`<p>big <img src="images/big.png" alt="big"/></p>`, [
        { href: "images/big.png", mediaType: "image/png", data: big },
      ]),
      { imageBase: IMAGE_BASE, onImage: (_ref, bytes) => void sizes.push(bytes.length) },
    );
    const key = await sha256Hex(big);
    expect(work.images).toEqual([
      { key, mediaType: "image/png", size: 5 * MiB, sourcePath: "images/big.png" },
    ]);
    expect(sizes).toEqual([5 * MiB]);
    expect(work.chapters[0]!.html).toContain(`<img src="${IMAGE_BASE}${key}"`);
  });

  it("Image over 5 MB is not stored", async () => {
    const calls: number[] = [];
    const work = await processEpub(
      epubOf(`<p>big <img src="images/big.png" alt="big"/></p>`, [
        { href: "images/big.png", mediaType: "image/png", data: pngOfSize(5 * MiB + 1) },
      ]),
      { imageBase: IMAGE_BASE, onImage: (_ref, bytes) => void calls.push(bytes.length) },
    );
    expect(work.images).toEqual([]);
    expect(calls).toEqual([]);
    expect(work.chapters[0]!.html).not.toContain("<img");
  });

  it("SVG, fonts and stylesheets are dropped", async () => {
    const calls: number[] = [];
    const work = await processEpub(
      epubOf(
        `<link rel="stylesheet" href="styles/skin.css"/><style>@font-face { font-family: f; src: url(fonts/f.woff2) }</style>
<div class="skin"><p class="skin">skin-text <img src="images/v.svg" alt="v"/> <img src="fonts/f.woff2" alt="f"/> <a href="styles/skin.css">css-link</a></p></div>`,
        [
          {
            href: "images/v.svg",
            mediaType: "image/svg+xml",
            data: strToU8(`<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>`),
          },
          { href: "fonts/f.woff2", mediaType: "font/woff2", data: strToU8("wOF2fontbytes") },
          { href: "styles/skin.css", mediaType: "text/css", data: strToU8(".skin { color: red }") },
        ],
      ),
      { imageBase: IMAGE_BASE, onImage: (_ref, bytes) => void calls.push(bytes.length) },
    );
    const html = work.chapters[0]!.html;
    expect(work.images).toEqual([]);
    expect(calls).toEqual([]);
    expect(html).not.toMatch(/svg|woff|\.css|@font-face|<link|<style|<img|class=/i);
    expect(html).toContain("skin-text");
    expect(work.reviewReasons.join("\n")).not.toContain("unread_manifest_item");
  });

  it("Lookalike interface markup is neutralized", async () => {
    const html = await chapterHtml(
      `<p>before-box</p><style>.box { position: fixed; top: 0; left: 0 }</style>
<form class="box" action="https://phish.example/login"><p>Session expired</p><input name="user"/><input type="password" name="pw"/><button>Log in again</button></form>
<div style="position:fixed;top:0;left:0;width:100%;background:white"><p>Session expired, please sign in</p></div><p>after-box</p>`,
    );
    expect(html).not.toMatch(
      /<form|<input|<button|<style|style=|position|phish\.example|Log in again/i,
    );
    for (const t of ["before-box", "after-box", "Session expired, please sign in"])
      expect(html).toContain(t);
  });
});
