// The pseud matching rule (ARCHITECTURE, Pseuds), applied to the opt-out
// request and to every byline at ingest. Pure: no Node or Workers import, so
// the web Worker and ingest can both load it. Deliberately not the tag rule in
// `./tags`: punctuation is kept here.

/** Unicode White_Space, which, unlike `\s`, includes next line (U+0085). */
const WHITESPACE = /[\p{White_Space}﻿]+/gu;

/**
 * A pseud's `pseud_norm`: NFKC, lowercased, inner runs of whitespace collapsed
 * to one space, then trimmed. NFKC comes first, so a no-break or ideographic
 * space becomes a plain one before the collapse. Punctuation is never folded:
 * `a_b` and `a b` are different pseuds. `toLowerCase` is not full Unicode case
 * folding (`ß` stays `ß`, not `ss`). The pseud itself is stored as written.
 */
export function normalizePseud(pseud: string): string {
  return pseud.normalize("NFKC").toLowerCase().replace(WHITESPACE, " ").trim();
}
