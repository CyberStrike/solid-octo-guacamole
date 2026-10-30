import {
  boundedText, cleanText, find, findAll, findOutermost, hasClass, idOf, nextElementSibling, type ElementNode,
} from "./dom";
import { collapseWhitespace, decodeEntities } from "./entities";
import type { Author, SeriesRef, Stats } from "./types";

// AO3 preface -> metadata. Fields are matched by label text, never by class:
// calibre renames classes. Only a few semantic hooks (ids, `byline`) survive.

export interface Preface {
  workId: string | null;
  title: string | null;
  authors: Author[];
  rating: string | null;
  warnings: string[];
  categories: string[];
  fandoms: string[];
  relationships: string[];
  characters: string[];
  freeforms: string[];
  language: string | null;
  series: SeriesRef[];
  stats: Stats;
  summary: ElementNode | null;
  notes: ElementNode | null;
  endNotes: ElementNode | null;
  rawMeta: Record<string, string>;
}

const WORK_URL = /^https?:\/\/(?:www\.)?archiveofourown\.org\/works\/(\d+)(?:[/?#]|$)/i;

export function workIdFromUrl(url: string): string | null {
  return WORK_URL.exec(url.trim())?.[1] ?? null;
}

type TagField = "rating" | "warnings" | "categories" | "fandoms" | "relationships" | "characters" | "freeforms";

// A Map, so a label such as "Constructor:" is not found on Object.prototype.
const TAG_LABELS = new Map<string, TagField>([
  ["rating", "rating"],
  ["ratings", "rating"],
  ["archive warning", "warnings"],
  ["archive warnings", "warnings"],
  ["category", "categories"],
  ["categories", "categories"],
  ["fandom", "fandoms"],
  ["fandoms", "fandoms"],
  ["relationship", "relationships"],
  ["relationships", "relationships"],
  ["character", "characters"],
  ["characters", "characters"],
  ["additional tag", "freeforms"],
  ["additional tags", "freeforms"],
]);

// Text caps for label predicates that run on every preface element.
const LABEL_CHARS = 64;
const LINE_CHARS = 2_000;

/** All outermost elements with this id, across the spine in order. */
export function regionsById(roots: readonly ElementNode[], id: string): ElementNode[] {
  return roots.flatMap((root) => findOutermost(root, (el) => idOf(el) === id));
}

function href(el: ElementNode): string {
  return decodeEntities(el.attrs["href"] ?? "").trim();
}

function tagList(dd: ElementNode): string[] {
  const links = findAll(dd, (el) => el.tag === "a");
  const names = links.length > 0 ? links.map(cleanText) : cleanText(dd).split(",").map((s) => s.trim());
  return names.filter((s) => s !== "");
}

function parseSeries(dd: ElementNode): SeriesRef[] {
  const out: SeriesRef[] = [];
  let before = "";
  for (const node of dd.children) {
    if (node.type === "element" && node.tag === "a") {
      const part = /part\s+(\d+)\s+of\s*$/i.exec(collapseWhitespace(before));
      const id = /archiveofourown\.org\/series\/(\d+)/i.exec(href(node));
      out.push({ name: cleanText(node), part: part ? Number(part[1]) : null, ao3SeriesId: id?.[1] ?? null });
      before = "";
    } else {
      before += cleanText(node) + " ";
    }
  }
  if (out.length === 0 && cleanText(dd) !== "") out.push({ name: cleanText(dd), part: null, ao3SeriesId: null });
  return out;
}

function parseStats(text: string, rawMeta: Record<string, string>): Stats {
  const stats: Stats = {
    published: null,
    updated: null,
    completed: null,
    words: null,
    chapters: { posted: 1, total: 1 },
  };
  for (const [, key, value] of text.matchAll(/([A-Za-z][A-Za-z ]*?):\s*(\S+)/g)) {
    switch (key!.trim().toLowerCase()) {
      case "published": stats.published = value!; break;
      case "updated": stats.updated = value!; break;
      case "completed": stats.completed = value!; break;
      case "words": {
        const n = Number(value!.replace(/[,.\s]/g, ""));
        stats.words = Number.isFinite(n) ? n : null;
        break;
      }
      case "chapters": {
        const m = /^(\d+)\/(\d+|\?)$/.exec(value!);
        if (m) stats.chapters = { posted: Number(m[1]), total: m[2] === "?" ? null : Number(m[2]) };
        else rawMeta["Stats: Chapters"] = value!;
        break;
      }
      default: rawMeta[`Stats: ${key!.trim()}`] = value!;
    }
  }
  return stats;
}

function parseAuthors(prefaces: ElementNode[]): Author[] {
  let byline: ElementNode | null = null;
  for (const region of prefaces) {
    byline = find(region, (el) => hasClass(el, "byline")) ??
      find(region, (el) => /^by\s/i.test(boundedText(el, LINE_CHARS) ?? "") && find(el, (a) => a.tag === "a" && /\bauthor\b/.test(a.attrs["rel"] ?? "")) !== null);
    if (byline) break;
  }
  if (!byline) return [];
  const links = findAll(byline, (el) => el.tag === "a" && (/\bauthor\b/.test(el.attrs["rel"] ?? "") || /\/users\//.test(href(el))));
  if (links.length === 0) {
    // e.g. "by Anonymous": names with no profile links.
    return cleanText(byline).replace(/^by\s+/i, "").split(/,\s*|\s+and\s+/).filter(Boolean).map((pseud) => ({ pseud, user: null }));
  }
  return links.map((a) => {
    const m = /\/users\/([^/?#]+)/.exec(href(a));
    let user: string | null = null;
    if (m) {
      try {
        user = decodeURIComponent(m[1]!);
      } catch {
        user = m[1]!;
      }
    }
    let pseud = cleanText(a);
    // AO3 writes "pseud (user)" when they differ.
    if (user && pseud.endsWith(` (${user})`)) pseud = pseud.slice(0, -(user.length + 3));
    return { pseud, user };
  });
}

/** The blockquote following a `<p>Summary</p>`-style label inside `scope`. */
function headedBlock(scope: readonly ElementNode[], label: string): ElementNode | null {
  const want = label.toLowerCase();
  for (const region of scope) {
    for (const heading of findAll(region, (el) => boundedText(el, LABEL_CHARS)?.toLowerCase() === want)) {
      const block = nextElementSibling(heading);
      if (block?.tag === "blockquote") return block;
    }
  }
  return null;
}

/** The work URL from the innermost "Posted originally on the Archive of Our Own" element. */
function findWorkId(prefaces: ElementNode[]): string | null {
  const posted = /posted originally on the archive of our own/i;
  for (const region of prefaces) {
    const matches = findAll(region, (el) => posted.test(boundedText(el, LINE_CHARS) ?? ""));
    // `matches` is in document order, so a match contains another exactly when
    // the next match starts inside it.
    const innermost = matches.filter((m, i) => {
      const next = matches[i + 1];
      return next === undefined || next.pos > m.end;
    });
    for (const line of innermost) {
      for (const a of findAll(line, (el) => el.tag === "a")) {
        const id = workIdFromUrl(href(a));
        if (id) return id;
      }
    }
  }
  return null;
}

export function parsePreface(roots: readonly ElementNode[]): Preface {
  const prefaces = regionsById(roots, "preface");
  // No prototype: labels come from the file, and may be "__proto__".
  const rawMeta: Record<string, string> = Object.create(null);
  const tags: Record<TagField, string[]> = {
    rating: [], warnings: [], categories: [], fandoms: [], relationships: [], characters: [], freeforms: [],
  };
  let language: string | null = null;
  let series: SeriesRef[] = [];
  let stats: Stats | null = null;

  const dl = prefaces.map((r) => find(r, (el) => el.tag === "dl" && hasClass(el, "tags")) ?? find(r, (el) => el.tag === "dl")).find(Boolean);
  if (dl) {
    let label: string | null = null;
    for (const node of dl.children) {
      if (node.type !== "element") continue;
      if (node.tag === "dt") {
        label = cleanText(node).replace(/\s*:\s*$/, "");
        continue;
      }
      if (node.tag !== "dd" || label === null) continue;
      const key = label.toLowerCase();
      const field = TAG_LABELS.get(key);
      if (field) tags[field].push(...tagList(node));
      else if (key === "language") language = cleanText(node) || null;
      else if (key === "series") series = series.concat(parseSeries(node));
      else if (key === "stats") stats = parseStats(cleanText(node), rawMeta);
      else rawMeta[label] = rawMeta[label] === undefined ? cleanText(node) : `${rawMeta[label]}, ${cleanText(node)}`;
    }
  }

  const h1 = prefaces.map((r) => find(r, (el) => el.tag === "h1")).find(Boolean);
  const endNoteScope = regionsById(roots, "endnotes");

  return {
    workId: findWorkId(prefaces),
    title: h1 ? cleanText(h1) || null : null,
    authors: parseAuthors(prefaces),
    rating: tags.rating[0] ?? null,
    warnings: tags.warnings,
    categories: tags.categories,
    fandoms: tags.fandoms,
    relationships: tags.relationships,
    characters: tags.characters,
    freeforms: tags.freeforms,
    language,
    series,
    stats: stats ?? parseStats("", rawMeta),
    summary: headedBlock(prefaces, "Summary"),
    notes: headedBlock(prefaces, "Notes"),
    endNotes: headedBlock(endNoteScope.length ? endNoteScope : regionsById(roots, "afterword"), "End Notes"),
    rawMeta,
  };
}
