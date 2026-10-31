// The tag listing, `/tags/:type/:name`: a tag's live works as work cards
// (FRONTEND-DISCOVERY, Components, Work card). Every live work, by AO3 work ID:
// B2 adds paging, sorting, filters and caching.

import {
  createDb,
  getTagName,
  isTagType,
  listLiveWorksByTag,
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
  // One connection: the request's two queries run one after the other.
  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString, max: 1 });
  try {
    // The heading first: a tag nobody has used is not found.
    const heading = await getTagName(db, type, name);
    if (heading === null) return c.notFound();
    return c.html(tagListingPage(heading, await listLiveWorksByTag(db, type, name)));
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
}

const tagListingPage = (heading: string, works: ListedWork[]) =>
  layout(
    heading,
    works.length === 0
      ? "<p>No works have this tag yet.</p>"
      : `<ol class="work-list">\n${works.map(workCard).join("\n")}\n</ol>`,
  );

const tagLinks = (tags: ListedWork["tags"]) =>
  tags
    .map((t) => `<a href="${escapeHtml(tagHref(t.type, t.name_norm))}">${escapeHtml(t.name)}</a>`)
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
const summary = (html: string | null, href: string) =>
  html
    ? `<div class="card-summary">${html}</div>\n<p class="card-more"><a href="${href}">more</a></p>`
    : "";

/** Words, chapters as posted/total ("?" when the total is unknown), completion, last updated. */
const stats = (work: ListedWork["work"]) =>
  [
    work.words === null ? "" : `${WORDS.format(work.words)} words`,
    `${work.chapters_count}/${work.chapters_total ?? "?"} chapters`,
    work.complete ? "Complete" : "In progress",
    work.updated_at === null ? "" : `Updated ${work.updated_at.toISOString().slice(0, 10)}`,
  ]
    .filter(Boolean)
    .join(" · ");

/** The six lines, in order: title and author, rating and warnings, fandoms, summary, tags, stats. */
function workCard({ work, authors, tags }: ListedWork): string {
  const href = `/works/${work.ao3_work_id}`;
  const ofType = (type: TagType) => tags.filter((t) => t.type === type);
  // Spelled out in bold, never a colour or a symbol, and never clamped.
  const warnings = ofType("warning").map((t) => t.name);
  const rating = [work.rating ?? "Not Rated", warnings.join(", ")].filter(Boolean);
  return `<li class="work-card">
<h2 class="card-title"><a href="${href}">${escapeHtml(work.title)}</a></h2>
<p class="card-byline">by ${escapeHtml(authors.map((a) => a.pseud).join(", "))}</p>
<p class="card-rating"><strong>${escapeHtml(rating.join(" · "))}</strong></p>
<p class="card-fandoms">${tagLinks(ofType("fandom"))}</p>
${summary(work.summary_html, href)}
<p class="card-tags">${cardTags(ofType("relationship"), ofType("character"), ofType("freeform").length)}</p>
<p class="card-stats">${stats(work)}</p>
</li>`;
}
