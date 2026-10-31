// The tag listing, `/tags/:type/:name`: a tag's live works as work cards
// (FRONTEND-DISCOVERY, Components, Work card). Every live work, by AO3 work ID:
// B2 adds paging, sorting, filters and caching.

import {
  createDb,
  getTagName,
  listLiveWorksByTag,
  type ListedWork,
  type TagType,
} from "@archive/db";
import type { Context } from "hono";
import type { Bindings } from "./env";
import { escapeHtml, layout } from "./pages";
import { tagHref } from "./tag-links";

const TAG_TYPES: readonly TagType[] = [
  "fandom",
  "relationship",
  "character",
  "freeform",
  "warning",
  "category",
  "rating",
];

const isTagType = (type: string): type is TagType => TAG_TYPES.some((t) => t === type);

export async function showTagListing(c: Context<{ Bindings: Bindings }>) {
  const type = c.req.param("type");
  const name = c.req.param("name");
  if (type === undefined || name === undefined || !isTagType(type)) return c.notFound();
  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString, max: 1 });
  try {
    // One after the other, on one connection.
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

function workCard({ work, tags }: ListedWork): string {
  const href = `/works/${work.ao3_work_id}`;
  const ofType = (type: TagType) => tags.filter((t) => t.type === type);
  return `<li class="work-card">
<h2 class="card-title"><a href="${href}">${escapeHtml(work.title)}</a></h2>
<p class="card-fandoms">${tagLinks(ofType("fandom"))}</p>
</li>`;
}
