// The tag matching rule (ARCHITECTURE, Tags). Pure: no Node or Workers import,
// so ingest, the web Worker and the seed helper can all load it.
import { TAG_TYPES, type TagType } from "./schema";

/** Whether a string, such as a URL segment, names a tag type. */
export function isTagType(type: string): type is TagType {
  return TAG_TYPES.some((t) => t === type);
}

const FOLDED = /[\p{P}\s]+/gu;
/** In a relationship tag, `/` (romantic) and `&` (platonic) mean different things. */
const KEPT_IN_RELATIONSHIPS = /[/&]/u;

/**
 * A tag's `name_norm`: NFKC, lowercased, each run of whitespace and Unicode
 * punctuation folded to one space, then trimmed. Relationship tags keep `/`
 * and `&`, so "Kirk/Spock" and "Kirk & Spock" stay different tags, while
 * "Kirk / Spock" and "Kirk/Spock" match.
 */
export function normalizeTagName(type: TagType, name: string): string {
  const keep = type === "relationship";
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(FOLDED, (run) => (keep ? foldKeeping(run) : " "))
    .trim();
}

/**
 * The order every writer of `tags` upserts in, so concurrent transactions lock
 * shared tag rows in one order and can't deadlock: by `type`, then `name`, by
 * UTF-16 code unit. Unlike `localeCompare`, it never ties distinct names
 * ("é" against "e" and a combining accent).
 */
export function compareTagKeys(
  a: { type: TagType; name: string },
  b: { type: TagType; name: string },
): number {
  return compareCodeUnits(a.type, b.type) || compareCodeUnits(a.name, b.name);
}

/** Compares strings by UTF-16 code unit: the same order in every database and locale. */
export function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Folds a run to the `/` and `&` in it, or to one space when it has neither. */
function foldKeeping(run: string): string {
  if (!KEPT_IN_RELATIONSHIPS.test(run)) return " ";
  return run.replace(/[^/&]/gu, "");
}
