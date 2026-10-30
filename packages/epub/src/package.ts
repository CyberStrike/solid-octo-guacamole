import { XMLParser } from "fast-xml-parser";
import { MAX_DEPTH, nodeBudget, type NodeBudget } from "./dom";
import { EpubError } from "./errors";
import { LIMITS } from "./unzip";

// container.xml -> OPF (metadata, manifest, spine) -> EPUB3 nav or NCX table of contents.

export interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  /** The manifest `properties` tokens, such as `nav`. */
  properties: string[];
}

export interface OpfMetadata {
  titles: string[];
  creators: string[];
  languages: string[];
  identifiers: string[];
  sources: string[];
  descriptions: string[];
}

export interface NavPoint {
  label: string;
  path: string;
  anchor: string | null;
}

export interface EpubPackage {
  opfPath: string;
  metadata: OpfMetadata;
  manifest: Map<string, ManifestItem>; // keyed by path
  spine: ManifestItem[];
  /** Spine `idref`s with no manifest item. */
  unknownSpineRefs: string[];
  navPoints: NavPoint[];
}

const ARRAY_TAGS = new Set([
  "rootfile", "item", "itemref", "navPoint", "title", "creator", "language",
  "identifier", "source", "description", "subject",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  attributesGroupName: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

// The nav document is XHTML with mixed content (`<a><span>1.</span> One</a>`),
// so its parser keeps document order and the whitespace between inline elements.
// It holds the XHTML parser's depth cap (dom.ts counts its root as one level).
const navParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  preserveOrder: true,
  maxNestedTags: MAX_DEPTH - 1,
});

type XmlNode = Record<string, unknown>;

function decodeXml(bytes: Uint8Array, what: string): string {
  const text = new TextDecoder().decode(bytes);
  // Refuse custom entities outright rather than rely on expansion limits.
  if (/<!ENTITY/i.test(text)) throw new EpubError("not_epub", `${what} declares XML entities`);
  return text;
}

function parseXml(bytes: Uint8Array, what: string): XmlNode {
  const text = decodeXml(bytes, what);
  try {
    return parser.parse(text) as XmlNode;
  } catch (e) {
    throw new EpubError("not_epub", `${what} is not valid XML`, { cause: e });
  }
}

/**
 * At least as many nodes as `text` parses into: one per start tag or
 * processing instruction, one per run of text between tags. Quoted `>` in
 * attributes and `<` inside comments or CDATA only over-count.
 */
function countXmlNodes(text: string): number {
  let nodes = 0;
  let inTag = false;
  let pendingText = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inTag) {
      if (c === 0x3e /* > */) inTag = false;
    } else if (c === 0x3c /* < */) {
      if (pendingText) nodes++;
      pendingText = false;
      inTag = true;
      const next = text.charCodeAt(i + 1);
      if (next === 0x3f /* ? */ || (next | 0x20) >= 0x61 && (next | 0x20) <= 0x7a) nodes++;
    } else {
      pendingText = true;
    }
  }
  return pendingText ? nodes + 1 : nodes;
}

/** Parses the nav document within the epub's node budget and depth cap. */
function parseNav(bytes: Uint8Array, budget: NodeBudget): OrderedNode[] {
  const text = decodeXml(bytes, "nav document");
  // fast-xml-parser has no node limit, so charge the budget before it builds the tree.
  budget.remaining -= countXmlNodes(text);
  if (budget.remaining < 0) throw new EpubError("too_large", `More than ${LIMITS.maxNodes} elements and text nodes`);
  try {
    return navParser.parse(text) as OrderedNode[];
  } catch (e) {
    // fast-xml-parser's message for maxNestedTags; nav.test.ts holds it to parse_failed.
    if (e instanceof Error && e.message === "Maximum nested tags exceeded") {
      throw new EpubError("parse_failed", `Elements nested more than ${MAX_DEPTH} deep in the nav document`, { cause: e });
    }
    throw new EpubError("not_epub", "nav document is not valid XML", { cause: e });
  }
}

function asArray(v: unknown): XmlNode[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as XmlNode[];
}

function child(node: unknown, name: string): XmlNode | undefined {
  if (!node || typeof node !== "object") return undefined;
  const v = (node as XmlNode)[name];
  return Array.isArray(v) ? (v[0] as XmlNode) : (v as XmlNode | undefined);
}

function attr(node: unknown, name: string): string | undefined {
  const group = child(node, "@");
  const v = group?.[name];
  return typeof v === "string" ? v : undefined;
}

function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (node && typeof node === "object") {
    const t = (node as XmlNode)["#text"];
    if (typeof t === "string") return t;
  }
  return "";
}

/** Resolves `href` (URL-encoded, possibly with #fragment) against a directory inside the zip. */
export function resolveHref(baseDir: string, href: string): { path: string; anchor: string | null } | null {
  const hash = href.indexOf("#");
  const rawPath = (hash === -1 ? href : href.slice(0, hash)).replace(/\?.*$/, "");
  const rawAnchor = hash === -1 ? null : href.slice(hash + 1);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawPath) || rawPath.startsWith("/")) return null;
  let decoded: string;
  let anchor: string | null;
  try {
    decoded = decodeURIComponent(rawPath);
    anchor = rawAnchor ? decodeURIComponent(rawAnchor) : null;
  } catch {
    return null;
  }
  if (decoded === "") return { path: "", anchor };
  const parts = baseDir ? baseDir.split("/") : [];
  for (const seg of decoded.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return { path: parts.join("/"), anchor };
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function readNavPoints(ncx: XmlNode, ncxDir: string): NavPoint[] {
  const found: { order: number; index: number; point: NavPoint }[] = [];
  const visit = (points: XmlNode[]) => {
    for (const p of points) {
      const src = attr(child(p, "content"), "src");
      const label = text(child(child(p, "navLabel"), "text")).replace(/\s+/g, " ").trim();
      const target = src === undefined ? null : resolveHref(ncxDir, src);
      if (target && target.path) {
        const order = Number.parseInt(attr(p, "playOrder") ?? "", 10);
        found.push({ order: Number.isFinite(order) ? order : Infinity, index: found.length, point: { label, ...target } });
      }
      visit(asArray(p["navPoint"]));
    }
  };
  visit(asArray(child(child(ncx, "ncx"), "navMap")?.["navPoint"]));
  found.sort((a, b) => a.order - b.order || a.index - b.index);
  return found.map((f) => f.point);
}

// preserveOrder nodes: `{ tag: children[], ":@": attributes }` or `{ "#text": string }`.
type OrderedNode = Record<string, unknown>;

function tagOf(node: OrderedNode): string | undefined {
  return Object.keys(node).find((k) => k !== ":@");
}

function kids(node: OrderedNode): OrderedNode[] {
  const tag = tagOf(node);
  const v = tag === undefined ? undefined : node[tag];
  return Array.isArray(v) ? (v as OrderedNode[]) : [];
}

function orderedAttr(node: OrderedNode, name: string): string | undefined {
  const v = (node[":@"] as Record<string, unknown> | undefined)?.[name];
  return typeof v === "string" ? v : undefined;
}

function tokens(v: string | undefined): string[] {
  return (v ?? "").split(/\s+/).filter((t) => t !== "");
}

function orderedText(node: OrderedNode): string {
  const t = node["#text"];
  if (typeof t === "string") return t;
  return kids(node).map(orderedText).join("");
}

function findOrdered(nodes: OrderedNode[], match: (n: OrderedNode) => boolean): OrderedNode | undefined {
  for (const n of nodes) {
    if (match(n)) return n;
    const found = findOrdered(kids(n), match);
    if (found) return found;
  }
  return undefined;
}

/** The entries of the nav document's `<nav epub:type="toc">`, in document order. */
function readNavDocument(nav: OrderedNode[], navPath: string): NavPoint[] {
  const navDir = dirOf(navPath);
  // removeNSPrefix turns `epub:type` into `type`.
  const toc = findOrdered(nav, (n) => tagOf(n) === "nav" && tokens(orderedAttr(n, "type")).includes("toc"));
  const found: NavPoint[] = [];
  // Each `li` holds an `a` (or a `span` heading with no target) and maybe a nested `ol`.
  const visit = (list: OrderedNode | undefined) => {
    for (const li of list ? kids(list) : []) {
      if (tagOf(li) !== "li") continue;
      const a = kids(li).find((n) => tagOf(n) === "a");
      const href = a && orderedAttr(a, "href");
      const target = href === undefined ? null : resolveHref(navDir, href);
      // `#id` alone targets the nav document itself, which may be in the spine.
      if (target && !target.path && target.anchor) target.path = navPath;
      if (a && target && target.path) found.push({ label: orderedText(a).replace(/\s+/g, " ").trim(), ...target });
      visit(kids(li).find((n) => tagOf(n) === "ol"));
    }
  };
  visit(toc && kids(toc).find((n) => tagOf(n) === "ol"));
  return found;
}

/** `budget` is the epub's shared node budget, charged for a nav document read here. */
export function readPackage(files: Map<string, Uint8Array>, budget: NodeBudget = nodeBudget()): EpubPackage {
  const containerBytes = files.get("META-INF/container.xml");
  if (!containerBytes) throw new EpubError("not_epub", "Missing META-INF/container.xml");
  const container = parseXml(containerBytes, "container.xml");
  const rootfiles = asArray(child(child(container, "container"), "rootfiles")?.["rootfile"]);
  const fullPath = rootfiles.map((r) => attr(r, "full-path")).find((p) => p !== undefined);
  const opfTarget = fullPath === undefined ? null : resolveHref("", fullPath);
  const opfBytes = opfTarget ? files.get(opfTarget.path) : undefined;
  if (!opfTarget || !opfBytes) throw new EpubError("not_epub", "Missing OPF package document");

  const opfPath = opfTarget.path;
  const opfDir = dirOf(opfPath);
  const pkg = child(parseXml(opfBytes, "OPF"), "package");
  const meta = child(pkg, "metadata");
  const texts = (name: string) => asArray(meta?.[name]).map(text).filter((s) => s !== "");

  const manifest = new Map<string, ManifestItem>();
  const byId = new Map<string, ManifestItem>();
  for (const item of asArray(child(pkg, "manifest")?.["item"])) {
    const id = attr(item, "id");
    const href = attr(item, "href");
    const target = href === undefined ? null : resolveHref(opfDir, href);
    if (id === undefined || !target || !target.path) continue;
    const entry: ManifestItem = {
      id,
      path: target.path,
      mediaType: (attr(item, "media-type") ?? "").toLowerCase(),
      properties: tokens(attr(item, "properties")),
    };
    manifest.set(entry.path, entry);
    byId.set(id, entry);
  }

  const spineNode = child(pkg, "spine");
  const spine: ManifestItem[] = [];
  const unknownSpineRefs: string[] = [];
  for (const ref of asArray(spineNode?.["itemref"])) {
    const idref = attr(ref, "idref") ?? "";
    const item = byId.get(idref);
    if (!item) unknownSpineRefs.push(idref);
    else if (item.mediaType === "application/xhtml+xml" || item.mediaType === "text/html") spine.push(item);
  }

  // The NCX wins; the EPUB3 nav is read only when there is no NCX, or it lists nothing usable.
  let navPoints: NavPoint[] = [];
  const tocItem = byId.get(attr(spineNode, "toc") ?? "") ??
    [...manifest.values()].find((i) => i.mediaType === "application/x-dtbncx+xml");
  const ncxBytes = tocItem ? files.get(tocItem.path) : undefined;
  if (tocItem && ncxBytes) navPoints = readNavPoints(parseXml(ncxBytes, "NCX"), dirOf(tocItem.path));
  if (navPoints.length === 0) {
    const navItem = [...manifest.values()].find((i) => i.properties.includes("nav"));
    const navBytes = navItem ? files.get(navItem.path) : undefined;
    if (navItem && navBytes) navPoints = readNavDocument(parseNav(navBytes, budget), navItem.path);
  }

  return {
    opfPath,
    metadata: {
      titles: texts("title"),
      creators: texts("creator"),
      languages: texts("language"),
      identifiers: texts("identifier"),
      sources: texts("source"),
      descriptions: texts("description"),
    },
    manifest,
    spine,
    unknownSpineRefs,
    navPoints,
  };
}
