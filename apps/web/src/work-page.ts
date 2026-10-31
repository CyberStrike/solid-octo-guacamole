// The work page, `/works/:id`, where :id is the AO3 work ID: a live work's
// metadata in the set order (FRONTEND-DISCOVERY, Typographic system: title,
// author, rating and warnings, fandom, summary, tags, stats), then its chapters.

import { createDb, getLiveWork, type LiveWork } from "@archive/db";
import type { Context } from "hono";
import type { Bindings } from "./env";
import { escapeHtml, layout } from "./pages";
import type { SecurityVariables } from "./security";
import { tagHref } from "./tag-links";

type WorkContext = Context<{ Bindings: Bindings; Variables: SecurityVariables }>;

type Tag = LiveWork["tags"][number];

// The tag list's hidden labels: the type is announced, never shown by colour
// (FRONTEND-DISCOVERY, Components, Tag list).
const TAG_LABELS: Record<Tag["type"], string> = {
  rating: "Rating",
  warning: "Warning",
  category: "Category",
  fandom: "Fandom",
  relationship: "Relationship",
  character: "Character",
  freeform: "Additional tag",
};

const tagLink = (tag: Tag) =>
  `<a href="${tagHref(tag.type, tag.name_norm)}">${escapeHtml(tag.name)}</a>`;

/** The work page's markup. Every stored string is escaped except the summary, sanitized at ingest. */
export function workPage(live: LiveWork): string {
  const { work, authors, tags, chapters } = live;
  const ofType = (type: Tag["type"]) => tags.filter((tag) => tag.type === type);
  const warnings = ofType("warning").map((tag) => escapeHtml(tag.name));
  const ratingLine = [escapeHtml(work.rating ?? "Not Rated"), warnings.join(", ")]
    .filter((part) => part !== "")
    .join(" · ");
  const listed = tags.filter((tag) => !["rating", "warning", "fandom"].includes(tag.type));
  const stats = [
    work.words === null ? null : `${work.words.toLocaleString("en")} words`,
    `Chapters ${work.chapters_count}/${work.chapters_total ?? "?"}`,
    work.complete ? "Complete" : "In progress",
  ].filter((part) => part !== null);
  return layout(
    work.title,
    `<p class="authors">by ${authors.map((a) => escapeHtml(a.pseud)).join(", ")}</p>
<p class="rating-warnings">${ratingLine}</p>
<p class="fandoms">${ofType("fandom").map(tagLink).join(", ")}</p>
<section class="summary">${work.summary_html ?? ""}</section>
<p class="tags">${listed.map((tag) => `<span class="visually-hidden">${TAG_LABELS[tag.type]}: </span>${tagLink(tag)}`).join(", ")}</p>
<p class="stats">${stats.join(" · ")}</p>
<ol class="chapters">${chapters.map((ch) => `<li>${escapeHtml(ch.title)}</li>`).join("")}</ol>
<p class="unofficial">rarepair is an unofficial stopgap, not the original archive: this copy is here while the original is offline.</p>
<p class="original"><a href="https://archiveofourown.org/works/${work.ao3_work_id}">The original work</a>, where the credit belongs. The link works again once the original archive is back.</p>`,
  );
}

/** `GET /works/:id`: the work page, or the not-found page when no live work has that ID. */
export async function showWork(c: WorkContext) {
  const id = Number(c.req.param("id"));
  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  try {
    const live = await getLiveWork(db, id);
    if (!live) return c.notFound();
    return c.html(workPage(live));
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
}
