// The tag listing, `/tags/:type/:name`: a tag's live works as work cards
// (FRONTEND-DISCOVERY, Components, Work card). Every live work, by AO3 work ID:
// B2 adds paging, sorting, filters and caching.

import {
  compareCodeUnits,
  createDb,
  isTagType,
  listLiveWorksByTag,
  normalizeTagName,
  type ListedWork,
  type TagType,
} from "@archive/db";
import type { Context } from "hono";
import type { Bindings } from "./env";
import { escapeHtml, layout } from "./pages";
import { tagHref } from "./tag-links";

const WORDS = new Intl.NumberFormat("en-US");

export async function showTagListing(c: Context<{ Bindings: Bindings }>) {
  const type = c.req.param("type");
  const name = c.req.param("name");
  if (type === undefined || name === undefined || !isTagType(type)) return c.notFound();
  const nameNorm = normalizeTagName(type, name);
  // A name of only punctuation folds to nothing, which names no tag.
  if (nameNorm === "") return c.notFound();
  // One query, on one connection.
  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString, max: 1 });
  try {
    const works = await listLiveWorksByTag(db, type, nameNorm);
    return c.html(tagListingPage(headingOf(works, type, nameNorm), works));
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
}

/**
 * The first spelling of the tag a listed work uses, by code unit. Only live
 * works count: a hidden or removed work's spelling is never shown, so a tag
 * only they use reads like one nobody has used, headed by its folded name.
 */
function headingOf(works: ListedWork[], type: TagType, nameNorm: string): string {
  const spellings = works.flatMap((w) =>
    w.tags.flatMap((t) => (t.type === type && t.name_norm === nameNorm ? [t.name] : [])),
  );
  return spellings.sort(compareCodeUnits)[0] ?? nameNorm;
}

const tagListingPage = (heading: string, works: ListedWork[]) =>
  layout(
    heading,
    works.length === 0
      ? "<p>No works have this tag yet.</p>"
      : `<ol class="work-list">\n${works.map(workCard).join("\n")}\n</ol>`,
  );

// A tag that folds to nothing has no listing, so it is shown without a link.
const tagLinks = (tags: ListedWork["tags"]) =>
  tags
    .map((t) =>
      t.name_norm === ""
        ? escapeHtml(t.name)
        : `<a href="${escapeHtml(tagHref(t.type, t.name_norm))}">${escapeHtml(t.name)}</a>`,
    )
    .join(", ");

/** How many relationships, and how many characters, a card names before "+n more". */
const SHOWN_PER_KIND = 3;

const someOf = (tags: ListedWork["tags"]) => {
  const rest = tags.length - SHOWN_PER_KIND;
  return tagLinks(tags.slice(0, SHOWN_PER_KIND)) + (rest > 0 ? `, +${rest} more` : "");
};

/** Relationships, then characters, then how many freeform tags there are besides. */
const cardTags = (
  relationships: ListedWork["tags"],
  characters: ListedWork["tags"],
  others: number,
) =>
  [
    someOf(relationships),
    someOf(characters),
    others ? `${others} other ${others === 1 ? "tag" : "tags"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * The summary as the sanitizer left it, whole: the stylesheet clamps it to three
 * lines. The server can't tell how many lines it takes, so "more" always follows.
 */
const summary = (html: string | null, href: string, title: string) =>
  html
    ? `<div class="card-summary">${html}</div>\n<p class="card-more"><a href="${href}" aria-label="more of ${escapeHtml(title)}">more</a></p>`
    : "";

/** Words, chapters as posted/total ("?" when the total is unknown), completion, last updated. */
const stats = (work: ListedWork["work"]) =>
  [
    work.words === null ? "" : `${WORDS.format(work.words)} words`,
    `${work.chapters_count}/${work.chapters_total ?? "?"} chapters`,
    work.complete ? "Complete" : "In progress",
    lastUpdated(work),
  ]
    .filter(Boolean)
    .join(" · ");

/** The updated date, or the published one for a work never updated since. */
const lastUpdated = ({ updated_at, published_at }: ListedWork["work"]) => {
  const at = updated_at ?? published_at;
  return at === null ? "" : `Updated ${at.toISOString().slice(0, 10)}`;
};

/** A card line, or nothing when it would be empty. */
const line = (className: string, html: string) =>
  html ? `<p class="${className}">${html}</p>` : "";

/** The six lines, in order: title and author, rating and warnings, fandoms, summary, tags, stats. */
function workCard({ work, authors, tags }: ListedWork): string {
  const href = `/works/${work.ao3_work_id}`;
  const ofType = (type: TagType) => tags.filter((t) => t.type === type);
  // Spelled out in bold, never a colour or a symbol, and never clamped.
  const warnings = ofType("warning").map((t) => t.name);
  const rating = [work.rating || "Not Rated", warnings.join(", ")].filter(Boolean);
  // No byline is shown as an anonymous one is.
  const byline = authors.map((a) => a.pseud).join(", ") || "Anonymous";
  return `<li class="work-card">
<h2 class="card-title"><a href="${href}">${escapeHtml(work.title)}</a></h2>
<p class="card-byline">by ${escapeHtml(byline)}</p>
<p class="card-rating"><strong>${escapeHtml(rating.join(" · "))}</strong></p>
${line("card-fandoms", tagLinks(ofType("fandom")))}
${summary(work.summary_html, href, work.title)}
${line("card-tags", cardTags(ofType("relationship"), ofType("character"), ofType("freeform").length))}
<p class="card-stats">${stats(work)}</p>
</li>`;
}
