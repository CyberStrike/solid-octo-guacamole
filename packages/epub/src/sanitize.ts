import { localName, type ElementNode, type Node } from "./dom";
import { decodeEntities, escapeAttr, escapeText, hasNamedEntity } from "./entities";

// The serializer builds output from scratch, so only what is listed here can
// ever reach a page. Allowlist from ARCHITECTURE "Sanitizing".

const ALLOWED = new Set([
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

const VOID_OUT = new Set(["br", "hr", "img"]);

/** Dropped together with everything inside them. */
const DROP = new Set([
  "script",
  "style",
  "title",
  "head",
  "iframe",
  "object",
  "embed",
  "form",
  "svg",
  "math",
  "noscript",
  "template",
  "textarea",
  "select",
  "button",
  "audio",
  "video",
  "canvas",
  "applet",
  "frame",
  "frameset",
  "noframes",
  "noembed",
  "xmp",
  "plaintext",
]);

/** Obsolete spellings of allowed elements. */
const RENAME = new Map([["strike", "s"]]);

// noreferrer: following a link must not tell the target which work a reader is on.
const EXTERNAL_REL = "nofollow noopener noreferrer ugc";

export interface SanitizeContext {
  /** Returns the rewritten URL for an epub-internal image, or null to drop the img. */
  resolveImage(src: string, fromFile: string): string | null;
  /** Elements to leave out entirely (e.g. AO3 navigation chrome). */
  skip?(el: ElementNode): boolean;
}

/**
 * Returns a normalised http(s) URL, or null. `raw` is the attribute value as
 * HTMLRewriter reports it, which may still contain entity references.
 */
export function safeHref(raw: string): string | null {
  const decoded = decodeEntities(raw);
  if (hasNamedEntity(decoded)) return null;
  // oxlint-disable-next-line no-control-regex -- strips control characters on purpose, so none can hide a scheme
  const cleaned = decoded.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  if (!/^https?:\/\//i.test(cleaned)) return null;
  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
}

function allowedAttrs(tag: string, el: ElementNode): string {
  let out = "";
  const add = (name: string, value: string) => {
    out += ` ${name}="${escapeAttr(value)}"`;
  };
  const get = (name: string) => {
    const v = el.attrs[name];
    return v === undefined ? undefined : decodeEntities(v).trim();
  };

  const title = get("title");
  if (title) add("title", title);
  const dir = get("dir")?.toLowerCase();
  if (dir === "ltr" || dir === "rtl" || dir === "auto") add("dir", dir);
  const lang = get("lang");
  if (lang && /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/.test(lang)) add("lang", lang);
  const align = get("align")?.toLowerCase();
  if (align === "left" || align === "right" || align === "center" || align === "justify")
    add("align", align);
  if (tag === "td" || tag === "th") {
    for (const name of ["colspan", "rowspan"]) {
      const v = get(name);
      if (v && /^[1-9]\d{0,2}$/.test(v)) add(name, v);
    }
  }
  return out;
}

function serializeNode(node: Node, ctx: SanitizeContext): string {
  if (node.type === "text") return escapeText(node.raw);

  // A prefixed name (`svg:script`) is dropped by its local name, and never
  // emitted as an allowed element: the prefix may bind any namespace.
  const local = localName(node.tag);
  if (DROP.has(local) || ctx.skip?.(node)) return "";

  const inner = () => serializeChildren(node.children, ctx);
  const tag = RENAME.get(node.tag) ?? node.tag;
  if (!ALLOWED.has(tag)) return inner(); // unknown wrapper: keep its content

  if (tag === "img") {
    const src = node.attrs["src"];
    const url = src === undefined ? null : ctx.resolveImage(decodeEntities(src).trim(), node.file);
    if (url === null) return "";
    const alt = decodeEntities(node.attrs["alt"] ?? "").trim();
    return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}"${allowedAttrs(tag, node)}>`;
  }

  let attrs = allowedAttrs(tag, node);
  if (tag === "a") {
    const href = node.attrs["href"] === undefined ? null : safeHref(node.attrs["href"]);
    // Internal links (other files, #fragments) and unsafe schemes become plain text.
    if (href === null) return inner();
    attrs = ` href="${escapeAttr(href)}" rel="${EXTERNAL_REL}"${attrs}`;
  }

  if (VOID_OUT.has(tag)) return `<${tag}${attrs}>`;
  const content = inner();
  if (tag === "span" && attrs === "") return content; // attribute-less spans carry nothing
  if (tag === "div" && attrs === "" && /^\s*$/.test(content)) return ""; // calibre page-break markers
  return `<${tag}${attrs}>${content}</${tag}>`;
}

export function serializeChildren(nodes: readonly Node[], ctx: SanitizeContext): string {
  let out = "";
  for (const node of nodes) out += serializeNode(node, ctx);
  return out;
}
