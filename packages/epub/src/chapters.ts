import { cleanText, find, findAll, hasClass, idOf, isBlankText, walk, type ElementNode, type Node } from "./dom";
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
  /**
   * Built one at a time as it is iterated, so only one chapter's copy of the
   * tree exists at once. Iterate it once.
   */
  chapters: Iterable<RawChapter>;
  method: "toc" | "headings" | "files";
  /** Content the split could not place with confidence. */
  reviewReasons: string[];
}

interface Start {
  pos: number;
  title: string | null;
}

const HEADING = /^h[1-6]$/;

/** Index of the first of `nodes` (siblings, in document order) whose subtree reaches `lo`. */
function firstReaching(nodes: readonly Node[], lo: number): number {
  let a = 0;
  let b = nodes.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (nodes[m]!.end < lo) a = m + 1;
    else b = m;
  }
  return a;
}

/** Calls `f` for each of `nodes` that overlaps [lo, hi), without visiting the others. */
function eachInRange(nodes: readonly Node[], lo: number, hi: number, f: (n: Node) => void): void {
  for (let i = firstReaching(nodes, lo); i < nodes.length && nodes[i]!.pos < hi; i++) f(nodes[i]!);
}

/** Deep-copies the parts of `node` (which overlaps [lo, hi)) whose positions fall in the range. */
function cloneRange(node: Node, lo: number, hi: number, parent: ElementNode | null): Node {
  if (node.type === "text") return { ...node, parent };
  const copy: ElementNode = { ...node, attrs: { ...node.attrs }, children: [], parent };
  eachInRange(node.children, lo, hi, (child) => copy.children.push(cloneRange(child, lo, hi, copy)));
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

/** First element with each id in `root`. */
function idIndex(root: ElementNode): Map<string, ElementNode> {
  const out = new Map<string, ElementNode>();
  walk(root, (n) => {
    if (n.type !== "element") return;
    const id = idOf(n);
    if (id !== undefined && !out.has(id)) out.set(id, n);
  });
  return out;
}

function startsFromToc(docs: SpineDoc[], perDoc: Map<SpineDoc, ElementNode[]>, navPoints: NavPoint[]): Start[] | null {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const ids = new Map<SpineDoc, Map<string, ElementNode>>();
  const regionSet = new Set([...perDoc.values()].flat());
  const regionOf = (el: ElementNode): ElementNode | null => {
    for (let p: ElementNode | null = el; p; p = p.parent) if (regionSet.has(p)) return p;
    return null;
  };

  const starts: Start[] = [];
  for (const np of navPoints) {
    const doc = byPath.get(np.path);
    if (!doc) continue;
    let target: ElementNode | null = null;
    if (np.anchor) {
      if (!ids.has(doc)) ids.set(doc, idIndex(doc.root));
      target = ids.get(doc)!.get(np.anchor) ?? null;
      // A broken TOC: the heading fallback is safer than merging chapters.
      if (!target) return null;
    }
    let pos: number | null = null;
    if (target && !regionSet.has(target)) {
      if (regionOf(target)) pos = target.pos;
    } else {
      // No anchor (or the anchor is the region itself): the file's first non-empty #chapters block.
      const region = target ?? perDoc.get(doc)!.find((r) => r.end > r.pos);
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

/** Copies of the content in [lo, hi) under `scopes` (in document order, not nested). */
function rangeContent(scopes: ElementNode[], lo: number, hi: number): Node[] {
  const out: Node[] = [];
  eachInRange(scopes, lo, hi, (scope) => {
    eachInRange((scope as ElementNode).children, lo, hi, (child) => out.push(cloneRange(child, lo, hi, null)));
  });
  return out;
}

function hasText(nodes: Node[]): boolean {
  return nodes.some((n) => cleanText(n) !== "" || (n.type === "element" && find(n, (e) => e.tag === "img") !== null));
}

function* build(scopes: ElementNode[], starts: Start[]): Generator<RawChapter> {
  for (let i = 0; i < starts.length; i++) {
    const hi = starts[i + 1]?.pos ?? Number.POSITIVE_INFINITY;
    const nodes = rangeContent(scopes, starts[i]!.pos, hi);
    const heading = takeLeadingHeading(nodes);
    yield { title: starts[i]!.title ?? heading ?? `Chapter ${i + 1}`, nodes };
  }
}

function* perFile(docs: SpineDoc[], perDoc: Map<SpineDoc, ElementNode[]>, hasRegions: boolean): Generator<RawChapter> {
  let n = 0;
  for (const doc of docs) {
    const scopes = hasRegions ? perDoc.get(doc)! : [find(doc.root, (el) => el.tag === "body") ?? doc.root];
    const nodes = rangeContent(scopes, 0, Number.POSITIVE_INFINITY);
    if (!hasText(nodes)) continue;
    const heading = takeLeadingHeading(nodes);
    n++;
    yield { title: heading ?? `Chapter ${n}`, nodes };
  }
}

function split(regions: ElementNode[], starts: Start[], method: "toc" | "headings", reviewReasons: string[]): ChapterSplit {
  if (hasText(rangeContent(regions, 0, starts[0]!.pos))) {
    reviewReasons.push("content_before_first_chapter: text in #chapters before the first chapter start");
  }
  return { chapters: build(regions, starts), method, reviewReasons };
}

export function splitChapters(docs: SpineDoc[], navPoints: NavPoint[]): ChapterSplit {
  const perDoc = new Map(docs.map((d) => [d, regionsById([d.root], "chapters")]));
  const regions = docs.flatMap((d) => perDoc.get(d)!);
  const reviewReasons: string[] = [];

  if (regions.length > 0) {
    // A spine file after the chapters start that has no region of its own is
    // not read. Calibre may continue a chapter in one; without a real example
    // of that, flag it rather than guess.
    const first = docs.findIndex((d) => perDoc.get(d)!.length > 0);
    for (const doc of docs.slice(first + 1)) {
      if (perDoc.get(doc)!.length > 0) continue;
      if (find(doc.root, (el) => idOf(el) === "preface" || idOf(el) === "afterword")) continue;
      const body = find(doc.root, (el) => el.tag === "body") ?? doc.root;
      if (hasText([body])) reviewReasons.push(`content_outside_chapters: ${doc.path}`);
    }

    const toc = startsFromToc(docs, perDoc, navPoints);
    if (toc) return split(regions, toc, "toc", reviewReasons);
    const headings = startsFromHeadings(regions);
    if (headings) return split(regions, headings, "headings", reviewReasons);
  }

  // Last resort: one chapter per spine file that has content.
  return { chapters: perFile(docs, perDoc, regions.length > 0), method: "files", reviewReasons };
}
