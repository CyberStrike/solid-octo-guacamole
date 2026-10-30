import { cleanText, find, findAll, hasClass, idOf, isAncestor, isBlankText, type ElementNode, type Node } from "./dom";
import type { NavPoint } from "./package";
import { regionsById } from "./preface";

// Spine files are not chapters: calibre splits by size, so a chapter can span
// files and a file can hold several chapters. A chapter is everything inside
// the `#chapters` regions from one chapter start (in document order across the
// spine) up to the next.

export interface SpineDoc {
  path: string;
  root: ElementNode;
}

export interface RawChapter {
  title: string;
  /** Detached copy of the chapter content, leading heading removed. */
  nodes: Node[];
}

export interface ChapterSplit {
  chapters: RawChapter[];
  method: "toc" | "headings" | "files";
}

interface Start {
  pos: number;
  title: string | null;
}

const HEADING = /^h[1-6]$/;

/** Deep-copies the parts of `node` whose positions fall in [lo, hi). */
function cloneRange(node: Node, lo: number, hi: number, parent: ElementNode | null): Node | null {
  if (node.end < lo || node.pos >= hi) return null;
  if (node.type === "text") return { ...node, parent };
  const copy: ElementNode = { ...node, attrs: { ...node.attrs }, children: [], parent };
  for (const child of node.children) {
    const c = cloneRange(child, lo, hi, copy);
    if (c) copy.children.push(c);
  }
  return copy;
}

/** Removes the chapter heading if it comes before any text; returns its text. */
function takeLeadingHeading(nodes: Node[]): string | null {
  let heading: ElementNode | null = null;
  let blocked = false;
  const visit = (n: Node) => {
    if (heading || blocked) return;
    if (n.type === "text") {
      if (!isBlankText(n)) blocked = true;
      return;
    }
    if (HEADING.test(n.tag)) {
      heading = n;
      return;
    }
    if (n.tag === "img" || n.tag === "hr") {
      blocked = true;
      return;
    }
    n.children.forEach(visit);
  };
  nodes.forEach(visit);
  if (!heading) return null;
  const h: ElementNode = heading;
  const siblings = h.parent ? h.parent.children : nodes;
  siblings.splice(siblings.indexOf(h), 1);
  return cleanText(h) || null;
}

function startsFromToc(docs: SpineDoc[], regions: ElementNode[], navPoints: NavPoint[]): Start[] | null {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const starts: Start[] = [];
  for (const np of navPoints) {
    const doc = byPath.get(np.path);
    if (!doc) continue;
    const inDoc = regions.filter((r) => r.pos >= doc.root.pos && r.pos <= doc.root.end);
    let pos: number | null = null;
    const target = np.anchor ? find(doc.root, (el) => idOf(el) === np.anchor) : null;
    if (np.anchor && !target) continue;
    if (target && !inDoc.includes(target)) {
      if (inDoc.some((r) => isAncestor(r, target))) pos = target.pos;
    } else {
      // No anchor (or the anchor is the region itself): the file's first non-empty #chapters block.
      const region = target ?? inDoc.find((r) => r.end > r.pos);
      if (region) pos = region.pos + 1;
    }
    if (pos === null) continue; // preface, afterword, or anything outside #chapters
    const prev = starts[starts.length - 1];
    if (prev && pos === prev.pos) continue;
    if (prev && pos < prev.pos) return null; // TOC order disagrees with the document
    starts.push({ pos, title: np.label || null });
  }
  return starts.length > 0 ? starts : null;
}

function startsFromHeadings(regions: ElementNode[]): Start[] | null {
  const headings = regions.flatMap((r) =>
    findAll(r, (el) => el.tag === "h2" && (hasClass(el, "toc-heading") || hasClass(el, "heading"))),
  );
  return headings.length > 0 ? headings.map((h) => ({ pos: h.pos, title: null })) : null;
}

function rangeContent(scopes: ElementNode[], lo: number, hi: number): Node[] {
  const out: Node[] = [];
  for (const scope of scopes) {
    if (scope.end < lo || scope.pos >= hi) continue;
    for (const child of scope.children) {
      const c = cloneRange(child, lo, hi, null);
      if (c) out.push(c);
    }
  }
  return out;
}

function hasText(nodes: Node[]): boolean {
  return nodes.some((n) => cleanText(n) !== "" || (n.type === "element" && find(n, (e) => e.tag === "img") !== null));
}

function build(scopes: ElementNode[], starts: Start[]): RawChapter[] {
  return starts.map((start, i) => {
    const hi = starts[i + 1]?.pos ?? Number.POSITIVE_INFINITY;
    const nodes = rangeContent(scopes, start.pos, hi);
    const heading = takeLeadingHeading(nodes);
    return { title: start.title ?? heading ?? `Chapter ${i + 1}`, nodes };
  });
}

export function splitChapters(docs: SpineDoc[], navPoints: NavPoint[]): ChapterSplit {
  const regions = regionsById(docs.map((d) => d.root), "chapters");

  if (regions.length > 0) {
    const toc = startsFromToc(docs, regions, navPoints);
    if (toc) return { chapters: build(regions, toc), method: "toc" };
    const headings = startsFromHeadings(regions);
    if (headings) return { chapters: build(regions, headings), method: "headings" };
  }

  // Last resort: one chapter per spine file that has content.
  const chapters: RawChapter[] = [];
  for (const doc of docs) {
    const inDoc = regions.filter((r) => r.pos >= doc.root.pos && r.pos <= doc.root.end);
    const scopes = regions.length > 0 ? inDoc : [find(doc.root, (el) => el.tag === "body") ?? doc.root];
    const nodes = rangeContent(scopes, 0, Number.POSITIVE_INFINITY);
    if (!hasText(nodes)) continue;
    const heading = takeLeadingHeading(nodes);
    chapters.push({ title: heading ?? `Chapter ${chapters.length + 1}`, nodes });
  }
  return { chapters, method: "files" };
}
