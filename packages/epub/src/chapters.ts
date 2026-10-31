import {
  cleanText,
  find,
  findAll,
  hasClass,
  idOf,
  isBlankText,
  isScriptOrStyle,
  walk,
  type ElementNode,
  type Node,
} from "./dom";
import { decodeEntities } from "./entities";
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
  /**
   * The number (from 1) of the chapter a link into spine file `path` lands in:
   * the chapter holding the first content of the element with id `anchor`
   * (the element itself when it holds none), or with no anchor the chapter
   * holding the file's first content. Null when no chapter holds it.
   */
  chapterFor(path: string, anchor: string | null): number | null;
}

interface Start {
  pos: number;
  title: string | null;
}

const HEADING = /^h[1-6]$/;

/** How many leading `items` satisfy `pred`, which holds for a prefix of them and fails after. */
function countWhile<T>(items: readonly T[], pred: (item: T) => boolean): number {
  let a = 0;
  let b = items.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (pred(items[m]!)) a = m + 1;
    else b = m;
  }
  return a;
}

/** Index of the first of `nodes` (siblings, in document order) whose subtree reaches `lo`. */
function firstReaching(nodes: readonly Node[], lo: number): number {
  return countWhile(nodes, (n) => n.end < lo);
}

/** Calls `f` for each of `nodes` that overlaps [lo, hi), without visiting the others. */
function eachInRange<N extends Node>(
  nodes: readonly N[],
  lo: number,
  hi: number,
  f: (n: N) => void,
): void {
  for (let i = firstReaching(nodes, lo); i < nodes.length && nodes[i]!.pos < hi; i++) f(nodes[i]!);
}

/** Deep-copies the parts of `node` (which overlaps [lo, hi)) whose positions fall in the range. */
function cloneRange(node: Node, lo: number, hi: number, parent: ElementNode | null): Node {
  if (node.type === "text") return { ...node, parent };
  const copy: ElementNode = { ...node, attrs: { ...node.attrs }, children: [], parent };
  eachInRange(node.children, lo, hi, (child) =>
    copy.children.push(cloneRange(child, lo, hi, copy)),
  );
  return copy;
}

/** Removes the chapter heading if it comes before any text; returns its text. */
function takeLeadingHeading(nodes: Node[]): string | null {
  // SAFETY: widens the initial null, so TS doesn't read it as null after visit has run.
  let heading = null as ElementNode | null;
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

/**
 * First element with each id in `root`, keyed by the id as written and as
 * decoded: NCX anchors can keep a character reference that links decode.
 */
function idIndex(root: ElementNode): Map<string, ElementNode> {
  const out = new Map<string, ElementNode>();
  walk(root, (n) => {
    if (n.type !== "element") return;
    const raw = idOf(n);
    if (raw === undefined) return;
    for (const id of [raw, decodeEntities(raw)]) if (!out.has(id)) out.set(id, n);
  });
  return out;
}

/** Spine files by path, and their elements by id, indexed on first use. */
function spineIndex(docs: SpineDoc[]) {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const ids = new Map<SpineDoc, Map<string, ElementNode>>();
  return {
    doc: (path: string): SpineDoc | undefined => byPath.get(path),
    element(doc: SpineDoc, id: string): ElementNode | null {
      if (!ids.has(doc)) ids.set(doc, idIndex(doc.root));
      return ids.get(doc)!.get(id) ?? null;
    },
  };
}

type SpineIndex = ReturnType<typeof spineIndex>;

function startsFromToc(
  index: SpineIndex,
  perDoc: Map<SpineDoc, ElementNode[]>,
  navPoints: NavPoint[],
): Start[] | null {
  const regionSet = new Set([...perDoc.values()].flat());
  const regionOf = (el: ElementNode): ElementNode | null => {
    for (let p: ElementNode | null = el; p; p = p.parent) if (regionSet.has(p)) return p;
    return null;
  };

  const starts: Start[] = [];
  for (const np of navPoints) {
    const doc = index.doc(np.path);
    if (!doc) continue;
    let target: ElementNode | null = null;
    if (np.anchor) {
      target = index.element(doc, np.anchor);
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
    eachInRange(scope.children, lo, hi, (child) => out.push(cloneRange(child, lo, hi, null)));
  });
  return out;
}

function hasText(nodes: Node[]): boolean {
  return nodes.some(
    (n) =>
      cleanText(n) !== "" || (n.type === "element" && find(n, (e) => e.tag === "img") !== null),
  );
}

function* build(scopes: ElementNode[], starts: Start[]): Generator<RawChapter> {
  for (let i = 0; i < starts.length; i++) {
    const hi = starts[i + 1]?.pos ?? Number.POSITIVE_INFINITY;
    const nodes = rangeContent(scopes, starts[i]!.pos, hi);
    const heading = takeLeadingHeading(nodes);
    yield { title: starts[i]!.title ?? heading ?? `Chapter ${i + 1}`, nodes };
  }
}

/** One chapter per entry: the scopes of each spine file that has content. */
function* perFile(files: ElementNode[][]): Generator<RawChapter> {
  for (const [i, scopes] of files.entries()) {
    const nodes = rangeContent(scopes, 0, Number.POSITIVE_INFINITY);
    const heading = takeLeadingHeading(nodes);
    yield { title: heading ?? `Chapter ${i + 1}`, nodes };
  }
}

/**
 * Returns a function giving the position of the first text or image among
 * `nodes` and their descendants, or null if they hold none. Each element's
 * answer is remembered, so however many links ask, every node is visited at
 * most once.
 */
function firstContentFinder(): (nodes: readonly Node[]) => number | null {
  const memo = new Map<ElementNode, number | null>();
  const ofElement = (el: ElementNode): number | null => {
    if (el.tag === "img") return el.pos;
    if (isScriptOrStyle(el)) return null;
    const known = memo.get(el);
    if (known !== undefined) return known;
    const found = first(el.children);
    memo.set(el, found);
    return found;
  };
  const first = (nodes: readonly Node[]): number | null => {
    for (const n of nodes) {
      const found = n.type === "text" ? (isBlankText(n) ? null : n.pos) : ofElement(n);
      if (found !== null) return found;
    }
    return null;
  };
  return first;
}

/** Where a link lands: the spine file, and a position inside that file's chapter scopes. */
interface Target {
  doc: SpineDoc;
  pos: number;
}

/**
 * Resolves a link into spine file `path`: to the first content of the element
 * with id `anchor` (so an anchor wrapping a chapter heading lands in that
 * chapter), or without an anchor to the file's first content. Null when the
 * file is not in the spine or the target is outside the file's `scopes`: in
 * the TOC and heading splits those are the #chapters regions, so a target in
 * the preface, afterword or end notes reaches no chapter.
 */
function linkTargets(
  index: SpineIndex,
  scopes: Map<SpineDoc, ElementNode[]>,
): (path: string, anchor: string | null) => Target | null {
  const firstContent = firstContentFinder();
  return (path, anchor) => {
    const doc = index.doc(path);
    if (!doc) return null;
    const own = scopes.get(doc)!;
    if (anchor === null) {
      const pos = firstContent(own);
      return pos === null ? null : { doc, pos };
    }
    const el = index.element(doc, anchor);
    if (!el) return null;
    const scope = own[firstReaching(own, el.pos)];
    if (!scope || scope.pos > el.pos) return null;
    return { doc, pos: firstContent([el]) ?? el.pos };
  };
}

function split(
  index: SpineIndex,
  perDoc: Map<SpineDoc, ElementNode[]>,
  regions: ElementNode[],
  starts: Start[],
  method: "toc" | "headings",
  reviewReasons: string[],
): ChapterSplit {
  if (hasText(rangeContent(regions, 0, starts[0]!.pos))) {
    reviewReasons.push(
      "content_before_first_chapter: text in #chapters before the first chapter start",
    );
  }
  const target = linkTargets(index, perDoc);
  return {
    chapters: build(regions, starts),
    method,
    reviewReasons,
    chapterFor(path, anchor) {
      const t = target(path, anchor);
      if (t === null) return null;
      // Chapter n holds the #chapters content from starts[n - 1] up to starts[n].
      const n = countWhile(starts, (s) => s.pos <= t.pos);
      return n === 0 ? null : n; // before the first start: in no chapter
    },
  };
}

export function splitChapters(docs: SpineDoc[], navPoints: NavPoint[]): ChapterSplit {
  const perDoc = new Map(docs.map((d) => [d, regionsById([d.root], "chapters")]));
  const regions = docs.flatMap((d) => perDoc.get(d)!);
  const index = spineIndex(docs);
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

    const toc = startsFromToc(index, perDoc, navPoints);
    if (toc) return split(index, perDoc, regions, toc, "toc", reviewReasons);
    const headings = startsFromHeadings(regions);
    if (headings) return split(index, perDoc, regions, headings, "headings", reviewReasons);
  }

  // Last resort: one chapter per spine file that has content.
  const scopes = new Map(
    docs.map((d) => [
      d,
      regions.length > 0 ? perDoc.get(d)! : [find(d.root, (el) => el.tag === "body") ?? d.root],
    ]),
  );
  // Checked on the tree itself, not on copies: memory is the tight limit here.
  const files = docs.filter((d) => hasText(scopes.get(d)!));
  const numbers = new Map(files.map((d, i) => [d, i + 1]));
  const target = linkTargets(index, scopes);
  return {
    chapters: perFile(files.map((d) => scopes.get(d)!)),
    method: "files",
    reviewReasons,
    chapterFor(path, anchor) {
      const t = target(path, anchor);
      return t === null ? null : (numbers.get(t.doc) ?? null);
    },
  };
}
