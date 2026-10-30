import { collapseWhitespace, decodeEntities } from "./entities";

// A small document tree built from HTMLRewriter's token stream. HTMLRewriter is
// used purely as a tokenizer here: its own output is discarded.

export interface ElementNode {
  type: "element";
  tag: string;
  /** Lowercased names, raw (undecoded) values, first occurrence wins. */
  attrs: Record<string, string>;
  children: Node[];
  parent: ElementNode | null;
  /** Path of the epub file this element came from (for resolving links). */
  file: string;
  /** Document-order index across the whole spine; see `numberTree`. */
  pos: number;
  /** `pos` of the last descendant (or own `pos` if none). */
  end: number;
}

export interface TextNode {
  type: "text";
  /** Raw source text, entities not decoded. */
  raw: string;
  parent: ElementNode | null;
  pos: number;
  end: number;
}

export type Node = ElementNode | TextNode;

const VOID = new Set([
  "area", "base", "basefont", "bgsound", "br", "col", "embed", "frame", "hr", "img",
  "input", "keygen", "link", "meta", "param", "source", "track", "wbr",
]);

// Opening one of these implicitly closes an open <p>, as in an HTML parser.
const CLOSES_P = new Set([
  "address", "article", "aside", "blockquote", "center", "details", "div", "dl",
  "fieldset", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hr", "main", "menu", "nav", "ol", "p", "pre", "section", "table", "ul",
]);

/**
 * Epub content documents are XHTML, where `<div/>` is an empty element.
 * HTMLRewriter parses as HTML, where it opens a div, and in this workerd build it
 * exposes no `selfClosing` flag. Rewrite non-void self-closing tags to an
 * explicit pair first. This only shapes the tree: everything still goes
 * through the allowlist serializer afterwards.
 */
const SELF_CLOSING =
  /<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`/]+))?)*)\s*\/>/g;

export function expandSelfClosing(html: string): string {
  return html.replace(SELF_CLOSING, (whole, tag: string, attrs: string) =>
    VOID.has(tag.toLowerCase()) ? whole : `<${tag}${attrs}></${tag}>`,
  );
}

function element(tag: string, file: string, parent: ElementNode | null): ElementNode {
  return { type: "element", tag, attrs: Object.create(null), children: [], parent, file, pos: 0, end: 0 };
}

function appendText(parent: ElementNode, raw: string): void {
  const last = parent.children[parent.children.length - 1];
  if (last?.type === "text") last.raw += raw;
  else parent.children.push({ type: "text", raw, parent, pos: 0, end: 0 });
}

// Deeper elements are flattened into their ancestor. Bounds recursion in every
// tree walk, and the cost of per-element text lookups on hostile input.
const MAX_DEPTH = 256;

/** Parses an HTML/XHTML string into a tree under a synthetic `#root` element. */
export async function parseHtml(html: string, file = ""): Promise<ElementNode> {
  const root = element("#root", file, null);
  const stack: ElementNode[] = [root];
  const top = (): ElementNode => stack[stack.length - 1]!;

  // Close by node reference, so a mismatched end tag also closes whatever was
  // left open inside it. An end tag for a node no longer open is ignored.
  const close = (node: ElementNode): void => {
    const i = stack.lastIndexOf(node);
    if (i > 0) stack.length = i;
  };

  const rewriter = new HTMLRewriter()
    .on("*", {
      element(el) {
        const tag = el.tagName.toLowerCase();
        if (CLOSES_P.has(tag) && top().tag === "p") stack.pop();
        const node = element(tag, file, top());
        for (const [name, value] of el.attributes) {
          const key = name!.toLowerCase();
          if (!(key in node.attrs)) node.attrs[key] = value ?? "";
        }
        top().children.push(node);
        if (VOID.has(tag) || stack.length >= MAX_DEPTH) return;
        try {
          el.onEndTag(() => close(node));
        } catch {
          return; // lol-html refuses end-tag handlers on elements that cannot have one.
        }
        stack.push(node);
      },
    })
    .onDocument({
      text(t) {
        if (t.text) appendText(top(), t.text);
      },
    });

  await rewriter.transform(new Response(expandSelfClosing(html))).arrayBuffer();
  return root;
}

/** Assigns document-order positions. Returns the next free position. */
export function numberTree(node: Node, start: number): number {
  node.pos = start;
  let next = start + 1;
  if (node.type === "element") {
    for (const child of node.children) next = numberTree(child, next);
  }
  node.end = next - 1;
  return next;
}

export function walk(node: Node, visit: (n: Node) => boolean | void): void {
  if (visit(node) === false) return;
  if (node.type === "element") for (const child of node.children) walk(child, visit);
}

export function findAll(root: Node, pred: (el: ElementNode) => boolean): ElementNode[] {
  const out: ElementNode[] = [];
  walk(root, (n) => {
    if (n.type === "element" && pred(n)) out.push(n);
  });
  return out;
}

export function find(root: Node, pred: (el: ElementNode) => boolean): ElementNode | null {
  let found: ElementNode | null = null;
  walk(root, (n) => {
    if (found) return false;
    if (n.type === "element" && pred(n)) {
      found = n;
      return false;
    }
    return true;
  });
  return found;
}

/** Outermost elements matching `pred` (matches nested inside a match are skipped). */
export function findOutermost(root: Node, pred: (el: ElementNode) => boolean): ElementNode[] {
  const out: ElementNode[] = [];
  walk(root, (n) => {
    if (n.type !== "element") return true;
    if (pred(n)) {
      out.push(n);
      return false;
    }
    return true;
  });
  return out;
}

export function hasClass(el: ElementNode, cls: string): boolean {
  const value = el.attrs["class"];
  return value !== undefined && value.split(/\s+/).includes(cls);
}

export function idOf(el: ElementNode): string | undefined {
  return el.attrs["id"];
}

export function isAncestor(ancestor: ElementNode, node: Node): boolean {
  for (let p = node.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

/** Decoded text content. Content of script/style is not text for our purposes. */
export function textContent(node: Node): string {
  if (node.type === "text") return decodeEntities(node.raw);
  if (node.tag === "script" || node.tag === "style") return "";
  let s = "";
  for (const child of node.children) s += textContent(child);
  return s;
}

export function cleanText(node: Node): string {
  return collapseWhitespace(textContent(node));
}

/** Source formatting whitespace only (a no-break space is content). */
export function isBlankText(node: Node): boolean {
  return node.type === "text" && /^[ \t\r\n\f]*$/.test(node.raw);
}

/** The next sibling element, skipping whitespace-only text. */
export function nextElementSibling(el: ElementNode): ElementNode | null {
  const siblings = el.parent?.children ?? [];
  for (let i = siblings.indexOf(el) + 1; i < siblings.length; i++) {
    const s = siblings[i]!;
    if (s.type === "element") return s;
    if (!isBlankText(s)) return null;
  }
  return null;
}
