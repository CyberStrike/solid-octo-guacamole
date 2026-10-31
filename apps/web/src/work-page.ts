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

/** An AO3 work ID as its URLs spell it: no sign, no leading zero, at most ten digits. */
const AO3_WORK_ID = /^[1-9]\d{0,9}$/;

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

/**
 * The original epub on the content host, `originals/<one segment>` as apps/content
 * serves it. The segment is the upload that made this version, the third part of
 * its prefix (`works/<ao3_work_id>/<upload_id>/`). Provisional: #119 settles the key.
 */
const originalHref = (r2Prefix: string) =>
  `https://content.rarepair.fans/originals/${encodeURIComponent(r2Prefix.split("/")[2] ?? "")}`;

/** The work page's markup. Every stored string is escaped except the summary, sanitized at ingest. */
export function workPage(live: LiveWork): string {
  const { work, authors, tags, chapters } = live;
  // The reading pages go by the AO3 work ID too, a number, so safe in an href.
  const base = `/works/${work.ao3_work_id}`;
  const ofType = (type: Tag["type"]) => tags.filter((tag) => tag.type === type);
  const warnings = ofType("warning").map((tag) => escapeHtml(tag.name));
  const ratingLine = [escapeHtml(work.rating ?? "Not Rated"), warnings.join(", ")]
    .filter((part) => part !== "")
    .join(" · ");
  const listed = tags.filter((tag) => !["rating", "warning", "fandom"].includes(tag.type));
  // The parser wasn't sure of the chapters, and no moderator has checked them yet.
  const needsCheck = live.version.review_reasons.length > 0 && live.version.checked_at === null;
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
${needsCheck ? `<p class="review-notice">Chapters may be imperfect; a moderator will check.</p>\n` : ""}<ol class="chapters">${chapters.map((ch) => `<li><a href="${base}/chapters/${ch.n}">${escapeHtml(ch.title)}</a></li>`).join("")}</ol>
<p class="full"><a href="${base}/full">Read the entire work on one page</a></p>
<p class="download"><a href="${originalHref(live.version.r2_prefix)}">Download original epub</a></p>
<p class="unofficial">rarepair is an unofficial stopgap, not the original archive: this copy is here while the original is offline.</p>
<p class="original"><a href="https://archiveofourown.org/works/${work.ao3_work_id}">The original work</a>, where the credit belongs. The link works again once the original archive is back.</p>`,
  );
}

/** `GET /works/:id`: the work page, or the not-found page when no live work has that ID. */
export async function showWork(c: WorkContext) {
  // Only the plain decimal form names a work: Number() alone also reads "0x3039"
  // and "1.2345e4" as 12345. getLiveWork answers anything past an int4 itself.
  const param = c.req.param("id") ?? "";
  if (!AO3_WORK_ID.test(param)) return c.notFound();
  const id = Number(param);
  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  try {
    const live = await getLiveWork(db, id);
    if (!live) return c.notFound();
    return c.html(workPage(live));
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
}
