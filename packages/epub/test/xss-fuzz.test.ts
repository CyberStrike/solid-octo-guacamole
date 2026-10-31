import { describe, expect, it } from "vitest";
import { EpubError, processEpub } from "../src";
import { CORPUS, generate, mutateCorpus, prng } from "./xss-corpus";
import { ao3Epub } from "./helpers";

// The oracle's allowlists are copied here on purpose: a change to the
// sanitizer must not be able to weaken the test (ARCHITECTURE "Sanitizing").
const TAGS = new Set([
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
]);
const ATTRS = new Set([
  "href",
  "src",
  "alt",
  "title",
  "colspan",
  "rowspan",
  "dir",
  "lang",
  "align",
  "rel",
]);
const IMAGE_BASE = "https://content.example/img/";
const SEED = 0x5eed06;
const GENERATED = 150; // per field; the run is deterministic and well under the timeout

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-z]+="[^"<>]*")*)\s*>/y;
const ATTR = /\s+([a-z]+)="([^"]*)"/g;

function decodeOnce(v: string): string {
  return v
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Walks the output as tokens, so it fails on any markup that is not an allowed tag. */
function violations(html: string): string[] {
  const bad: string[] = [];
  const stack: string[] = [];
  let i = 0;
  while (i < html.length) {
    const ch = html[i]!;
    if (ch === ">") {
      bad.push(`raw > in text at ${i}`);
      i++;
    } else if (ch !== "<") {
      i++;
    } else {
      TAG.lastIndex = i;
      const m = TAG.exec(html);
      if (m === null) {
        bad.push(`raw < not opening an allowed tag at ${i}`);
        i++;
        continue;
      }
      i = TAG.lastIndex;
      const [, slash, rawName, attrText] = m;
      const name = rawName!.toLowerCase();
      if (!TAGS.has(name) || name !== rawName) bad.push(`tag ${rawName}`);
      if (slash) {
        if (attrText) bad.push(`attributes on closing tag ${name}`);
        if (stack.pop() !== name) bad.push(`unbalanced </${name}>`);
        continue;
      }
      if (!["br", "hr", "img"].includes(name)) stack.push(name);
      for (const a of attrText!.matchAll(ATTR)) {
        const attr = a[1]!;
        const value = decodeOnce(a[2]!);
        if (!ATTRS.has(attr)) bad.push(`attribute ${attr}`);
        if (attr === "href" && !/^https?:\/\//.test(value)) bad.push(`href ${value}`);
        if (attr === "src" && !value.startsWith(IMAGE_BASE)) bad.push(`src ${value}`);
        if (attr === "rel" && value !== "nofollow noopener noreferrer ugc")
          bad.push(`rel ${value}`);
        // oxlint-disable-next-line no-control-regex -- control characters can hide a scheme
        const squeezed = value.replace(/[\u0000- ]/g, "").toLowerCase();
        if (/^(javascript|vbscript|data):/.test(squeezed)) bad.push(`scheme in ${attr}`);
      }
    }
  }
  if (stack.length > 0) bad.push(`unclosed ${stack.join(",")}`);
  return bad;
}

function assertSafe(html: string | null, input: string): void {
  expect(html, `no output for ${JSON.stringify(input)}`).not.toBeNull();
  const found = violations(html!);
  expect(found, `${found.join("; ")}\ninput: ${JSON.stringify(input)}\noutput: ${html}`).toEqual(
    [],
  );
}

const chapterOf = (inner: string) =>
  `<div id="chapters"><h2 class="toc-heading">T</h2><div>${inner}</div></div>`;

type Field = "chapter" | "summary" | "notes" | "endNotes";
const FIELDS: Field[] = ["chapter", "summary", "notes", "endNotes"];

async function run(field: Field, inner: string) {
  const epub =
    field === "chapter"
      ? ao3Epub({ files: [{ name: "x_split_001.xhtml", body: chapterOf(inner) }] })
      : ao3Epub({ [field]: inner });
  const work = await processEpub(epub, { imageBase: IMAGE_BASE });
  const html = {
    chapter: work.chapters[0]?.html ?? null,
    summary: work.summaryHtml,
    notes: work.notesHtml,
    endNotes: work.endNotesHtml,
  }[field];
  return html;
}

const markered = (inputs: string[]) =>
  inputs.map((html, n) => `<p>alpha-${n}</p>${html}`).join("\n");

// oxlint-disable-next-line deslop/no-unknown-parameters -- takes a caught value, which is unknown until this checks it
const isRejection = (e: unknown) => e instanceof EpubError && e.code === "parse_failed";

/**
 * HTMLRewriter refuses some markup outright (a `<noembed>` inside a `<select>`),
 * and processEpub reports that as `parse_failed`: a rejection, not a bypass.
 * When a batch is rejected, each input is retried alone and may only be
 * rejected with that same code.
 */
async function checkAll(field: Field, inputs: string[]): Promise<void> {
  try {
    assertSafe(await run(field, markered(inputs)), inputs.join("\n---\n"));
    return;
  } catch (e) {
    if (!isRejection(e)) throw e;
  }
  for (const input of inputs) {
    try {
      assertSafe(await run(field, markered([input])), input);
    } catch (e) {
      if (!isRejection(e)) throw e;
    }
  }
}

describe("Fuzzing with an XSS corpus finds no bypass", () => {
  const families = [...new Set(CORPUS.map((p) => p.family))];

  for (const field of FIELDS) {
    it(`yields only allowed markup from every corpus family in the ${field}`, async () => {
      for (const family of families) {
        const inputs = CORPUS.filter((p) => p.family === family).map((p) => p.html);
        await checkAll(field, inputs);
      }
    });

    it(`yields only allowed markup from seeded mutations in the ${field}`, async () => {
      const r = prng(SEED + FIELDS.indexOf(field));
      const batches = 10;
      for (let b = 0; b < batches; b++) {
        const inputs = Array.from({ length: GENERATED / batches }, (_, i) =>
          i % 2 === 0 ? generate(r) : mutateCorpus(r),
        );
        await checkAll(field, inputs);
      }
    });
  }

  it("rejects markup the streaming parser cannot classify with a parse_failed code", async () => {
    await expect(
      run("chapter", `<select><noembed><img src=x onerror=alert(1)></noembed></select>`),
    ).rejects.toMatchObject({ code: "parse_failed" });
  });

  it("yields only allowed markup from each corpus payload alone, and keeps the text before it", async () => {
    for (const [n, p] of CORPUS.entries()) {
      let html: string | null;
      try {
        html = await run("chapter", `<p>alpha-${n}</p>${p.html}`);
      } catch (e) {
        if (!isRejection(e)) throw e;
        continue;
      }
      assertSafe(html, p.html);
      expect(html, p.html).toContain(`alpha-${n}`);
    }
  });

  it("keeps an inline image from the manifest and drops a handler on it", async () => {
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    const work = await processEpub(
      ao3Epub({
        files: [
          {
            name: "x_split_001.xhtml",
            body: chapterOf(
              `<p><img src="images/p.png" onerror="alert(1)" style="x:y" alt="a"></p>`,
            ),
          },
        ],
        extraManifest: [{ href: "images/p.png", mediaType: "image/png", data: png }],
      }),
      { imageBase: IMAGE_BASE },
    );
    const html = work.chapters[0]!.html;
    expect(html).toMatch(
      /^<div><p><img src="https:\/\/content\.example\/img\/[^"]+" alt="a"><\/p><\/div>$/,
    );
    expect(violations(html)).toEqual([]);
  });

  it("gives identical output for the same input on two runs", async () => {
    const r = prng(SEED);
    const inputs = Array.from({ length: 40 }, () => generate(r));
    const body = markered([...CORPUS.map((p) => p.html), ...inputs]);
    for (const field of FIELDS) {
      const once = async () => {
        try {
          return await run(field, body);
        } catch (e) {
          if (!isRejection(e)) throw e;
          return "parse_failed";
        }
      };
      expect(await once()).toBe(await once());
    }
  });

  it("can tell a bypass from safe output", () => {
    expect(violations(`<p>a</p>`)).toEqual([]);
    expect(violations(`<script>x</script>`)).not.toEqual([]);
    expect(violations(`<p onclick="x">a</p>`)).not.toEqual([]);
    expect(
      violations(`<a href="javascript:x" rel="nofollow noopener noreferrer ugc">a</a>`),
    ).not.toEqual([]);
    expect(violations(`<p>a < b</p>`)).not.toEqual([]);
    expect(violations(`<p>a`)).not.toEqual([]);
    expect(violations(`<img src="https://other.example/x" alt="">`)).not.toEqual([]);
  });
});
