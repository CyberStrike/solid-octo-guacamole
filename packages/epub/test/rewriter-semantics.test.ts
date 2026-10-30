import { describe, expect, it } from "vitest";
import { expandSelfClosing, parseHtml, type ElementNode, type Node } from "../src/dom";

// Pins the HTMLRewriter behaviour the tokenizer relies on, as observed in workerd.

async function events(html: string): Promise<string[]> {
  const out: string[] = [];
  await new HTMLRewriter()
    .on("*", {
      element(el) {
        out.push(`<${el.tagName} ${JSON.stringify([...el.attributes])}>`);
        try {
          el.onEndTag((end) => {
            out.push(`</${end.name}>`);
          });
        } catch {
          out.push(`(no end tag for ${el.tagName})`);
        }
      },
    })
    .onDocument({
      text(t) {
        if (t.text) out.push(t.text);
      },
    })
    .transform(new Response(html))
    .arrayBuffer();
  return out;
}

/** Compact shape of a tree: tag(children) with text as quoted strings. */
function shape(node: Node): string {
  if (node.type === "text") return JSON.stringify(node.raw);
  return `${node.tag}(${node.children.map(shape).join(",")})`;
}

describe("HTMLRewriter as a tokenizer", () => {
  it("reports text and attribute values raw, without decoding entities", async () => {
    const ev = await events(`<p title="a &amp; b &#x3c;">x &amp; y &#x3c; z</p>`);
    expect(ev.join("")).toContain(`[["title","a &amp; b &#x3c;"]]`);
    expect(ev.join("")).toContain("x &amp; y &#x3c; z");
  });

  it("lowercases tag names", async () => {
    expect((await events("<ScRiPt></ScRiPt>"))[0]).toMatch(/^<script /);
  });

  it("refuses end-tag handlers on void elements", async () => {
    expect(await events("<br/><img src=x>")).toContain("(no end tag for br)");
  });

  it("pairs an end tag with the innermost open element of that name, HTML style", async () => {
    // The self-closing inner div takes the outer div's end tag.
    expect(await events("<div><div/>inner</div>")).toEqual([`<div []>`, `<div []>`, "inner", "</div>"]);
  });
});

describe("parseHtml", () => {
  it("treats XHTML self-closing tags as empty elements", async () => {
    expect(expandSelfClosing(`<div a="1"/><br/><a id='x' />`)).toBe(`<div a="1"></div><br/><a id='x'></a>`);
    const root = await parseHtml("<div><div/>inner</div>after");
    expect(shape(root)).toBe(`#root(div(div(),"inner"),"after")`);
  });

  it("closes unclosed elements on a mismatched end tag and at EOF", async () => {
    const root = await parseHtml("<div><span><b>text</div>tail<p>open");
    expect(shape(root)).toBe(`#root(div(span(b("text"))),"tail",p("open"))`);
  });

  it("closes an open <p> when a block starts, like an HTML parser", async () => {
    const root = await parseHtml("<p>a<p>b</p>c");
    expect(shape(root)).toBe(`#root(p("a"),p("b"),"c")`);
  });

  it("flattens nesting past the depth cap instead of recursing without bound", async () => {
    const root = await parseHtml("<div>".repeat(5_000) + "deep" + "</div>".repeat(5_000));
    let depth = 0;
    for (let n: Node = root; n.type === "element" && n.children.length > 0; n = n.children[0]!) depth++;
    expect(depth).toBeLessThanOrEqual(257);
  });

  // workerd freezes clocks during synchronous code, so there is no timing
  // assertion: a backtracking regression shows up as a hung run instead.
  it("rewrites self-closing tags without backtracking blow-up", () => {
    expect(expandSelfClosing("<a " + "x ".repeat(500_000))).toHaveLength(1_000_003);
    expect(expandSelfClosing('<a x="' + "<b ".repeat(500_000))).toHaveLength(1_500_006);
    expect(expandSelfClosing("<a x=y".repeat(200_000))).toHaveLength(1_200_000);
  });

  it("keeps raw text inside script for the serializer to drop", async () => {
    const root = await parseHtml(`<script>if (a < b) alert("x")</script>`);
    const script = root.children[0] as ElementNode;
    expect(script.tag).toBe("script");
    expect(shape(script)).toContain("alert");
  });
});
