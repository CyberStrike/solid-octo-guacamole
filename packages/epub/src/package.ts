import { XMLParser } from "fast-xml-parser";
import { EpubError } from "./errors";

// container.xml -> OPF (metadata, manifest, spine) -> NCX table of contents.

export interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
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

type XmlNode = Record<string, unknown>;

function parseXml(bytes: Uint8Array, what: string): XmlNode {
  const text = new TextDecoder().decode(bytes);
  // Refuse custom entities outright rather than rely on expansion limits.
  if (/<!ENTITY/i.test(text)) throw new EpubError("not_epub", `${what} declares XML entities`);
  try {
    return parser.parse(text) as XmlNode;
  } catch (e) {
    throw new EpubError("not_epub", `${what} is not valid XML`, { cause: e });
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

export function readPackage(files: Map<string, Uint8Array>): EpubPackage {
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
    const entry: ManifestItem = { id, path: target.path, mediaType: (attr(item, "media-type") ?? "").toLowerCase() };
    manifest.set(entry.path, entry);
    byId.set(id, entry);
  }

  const spineNode = child(pkg, "spine");
  const spine: ManifestItem[] = [];
  for (const ref of asArray(spineNode?.["itemref"])) {
    const item = byId.get(attr(ref, "idref") ?? "");
    if (item && (item.mediaType === "application/xhtml+xml" || item.mediaType === "text/html")) spine.push(item);
  }

  let navPoints: NavPoint[] = [];
  const tocItem = byId.get(attr(spineNode, "toc") ?? "") ??
    [...manifest.values()].find((i) => i.mediaType === "application/x-dtbncx+xml");
  const ncxBytes = tocItem ? files.get(tocItem.path) : undefined;
  if (tocItem && ncxBytes) navPoints = readNavPoints(parseXml(ncxBytes, "NCX"), dirOf(tocItem.path));

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
    navPoints,
  };
}
