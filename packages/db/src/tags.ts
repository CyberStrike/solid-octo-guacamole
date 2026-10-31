// The tag matching rule (ARCHITECTURE, Tags). Pure: no Node or Workers import,
// so ingest, the web Worker and the seed helper can all load it.
import type { TagType } from "./schema";

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

/** Folds a run to the `/` and `&` in it, or to one space when it has neither. */
function foldKeeping(run: string): string {
  if (!KEPT_IN_RELATIONSHIPS.test(run)) return " ";
  return run.replace(/[^/&]/gu, "");
}
