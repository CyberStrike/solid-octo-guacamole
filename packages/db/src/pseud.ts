// The pseud matching rule (ARCHITECTURE, Pseuds), applied to the opt-out
// request and to every byline at ingest. Pure: no Node or Workers import, so
// the web Worker and ingest can both load it. Deliberately not the tag rule in
// `./tags`: punctuation is kept here.

/** Unicode White_Space, which, unlike `\s`, includes next line (U+0085). */
const WHITESPACE = /\p{White_Space}+/gu;
/**
 * Characters that render as nothing: zero-width spaces and joiners, the word
 * joiner, the soft hyphen, the byte order mark, variation selectors.
 */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;

/**
 * A pseud's `pseud_norm`: NFKC, invisible characters dropped, lowercased, NFKC
 * again, inner runs of Unicode whitespace collapsed to one space, then trimmed.
 * Dropping invisibles means `Moon<U+200B> Child` matches `Moon Child`. The
 * second NFKC puts back what lowercasing and the drop can undo: a lowercase
 * letter can have a precomposed form its capital lacks (`J` with a caron), and
 * a dropped grapheme joiner can leave combining marks out of order. Punctuation
 * is never folded into whitespace, so `a_b` and `a b` are different pseuds,
 * though NFKC still rewrites compatibility forms (`…` becomes `...`).
 * `toLowerCase` is not full Unicode case folding (`ß` stays `ß`, not `ss`). A
 * byline's pseud is stored as written, in `work_authors.pseud`.
 */
export function normalizePseud(pseud: string): string {
  return pseud
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(WHITESPACE, " ")
    .trim();
}
