// The pseud matching rule (ARCHITECTURE, Pseuds), applied to the opt-out
// request and to every byline at ingest. Pure: no Node or Workers import, so
// the web Worker and ingest can both load it. Deliberately not the tag rule in
// `./tags`: punctuation is kept here.

/**
 * Unicode White_Space, which, unlike `\s`, includes next line (U+0085), plus
 * the byte order mark (U+FEFF), which `\s` and `trim` count as whitespace.
 */
const WHITESPACE = /[\p{White_Space}\u{FEFF}]+/gu;

/**
 * A pseud's `pseud_norm`: NFKC, lowercased, NFKC again (a lowercase letter can
 * have a precomposed form its capital lacks, such as `J` with a caron), inner
 * runs of Unicode whitespace collapsed to one space, then trimmed. Punctuation
 * is never folded into whitespace, so `a_b` and `a b` are different pseuds,
 * though NFKC still rewrites compatibility forms (`…` becomes `...`).
 * `toLowerCase` is not full Unicode case folding (`ß` stays `ß`, not `ss`). A
 * byline's pseud is stored as written, in `work_authors.pseud`.
 */
export function normalizePseud(pseud: string): string {
  return pseud.normalize("NFKC").toLowerCase().normalize("NFKC").replace(WHITESPACE, " ").trim();
}
