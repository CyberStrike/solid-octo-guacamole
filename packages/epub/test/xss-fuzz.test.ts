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

/** What a browser would make of a value that still holds references: numeric ones and the few named ones that hide a scheme. */
function decodeReferences(v: string): string {
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(Tab|NewLine);/g, "")
    .replace(/&colon;/g, ":");
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
        const squeezed = decodeReferences(value)
          // oxlint-disable-next-line no-control-regex -- control characters can hide a scheme
          .replace(/[\u0000- ]/g, "")
          .toLowerCase();
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
 * Returns whether the input was checked, or rejected for that reason; any
 * other error propagates. Every checked output keeps the paragraph before it.
 */
async function checkAlone(field: Field, input: string): Promise<"checked" | "rejected"> {
  let html: string | null;
  try {
    html = await run(field, markered([input]));
  } catch (e) {
    if (isRejection(e)) return "rejected";
    throw e;
  }
  assertSafe(html, input);
  expect(html, `lost the text before ${JSON.stringify(input)}`).toContain("<p>alpha-0</p>");
  return "checked";
}

/** Each input in its own epub, so an earlier payload can't swallow a later one. */
async function checkEach(field: Field, inputs: string[]): Promise<void> {
  let checked = 0;
  for (const input of inputs) if ((await checkAlone(field, input)) === "checked") checked++;
  // A sanitizer that rejected nearly everything would make this test vacuous.
  expect(
    checked,
    `${field}: only ${checked} of ${inputs.length} inputs were accepted`,
  ).toBeGreaterThanOrEqual(Math.ceil(inputs.length * 0.9));
}

/** Many inputs in one epub, to catch an earlier payload changing how later ones parse. */
async function checkTogether(field: Field, inputs: string[]): Promise<void> {
  let html: string | null;
  try {
    html = await run(field, markered(inputs));
  } catch (e) {
    if (isRejection(e)) return; // the same inputs are checked alone by checkEach
    throw e;
  }
  assertSafe(html, inputs.join("\n---\n"));
}

const generated = (field: Field): string[] => {
  const r = prng(SEED + FIELDS.indexOf(field));
  return Array.from({ length: GENERATED }, (_, i) => (i % 2 === 0 ? generate(r) : mutateCorpus(r)));
};

describe("Fuzzing with an XSS corpus finds no bypass", () => {
  const families = [...new Set(CORPUS.map((p) => p.family))];

  for (const field of FIELDS) {
    it(`yields only allowed markup from each corpus payload alone in the ${field}`, async () => {
      await checkEach(
        field,
        CORPUS.map((p) => p.html),
      );
    });

    it(`yields only allowed markup from each seeded mutation alone in the ${field}`, async () => {
      await checkEach(field, generated(field));
    });

    it(`yields only allowed markup from payloads that share a document in the ${field}`, async () => {
      for (const family of families) {
        await checkTogether(
          field,
          CORPUS.filter((p) => p.family === family).map((p) => p.html),
        );
      }
      const inputs = generated(field);
      for (let b = 0; b < inputs.length; b += 15)
        await checkTogether(field, inputs.slice(b, b + 15));
    });
  }

  it("rejects markup the streaming parser cannot classify with a parse_failed code", async () => {
    await expect(
      run("chapter", `<select><noembed><img src=x onerror=alert(1)></noembed></select>`),
    ).rejects.toMatchObject({ code: "parse_failed" });
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
          return `parse_failed: ${e instanceof Error ? e.message : ""}`;
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
