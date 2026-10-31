// The "may be imperfect" notice, for a version ingest flagged with review reasons that
// no moderator has checked yet. The chapter and entire-work pages show it; the work
// page still has its own copy (#211).

import type { LiveWork } from "@archive/db";

type Checked = Pick<LiveWork["version"], "review_reasons" | "checked_at">;

/** Whether a version's chapters still wait on a moderator's check. */
export const needsCheck = (version: Checked) =>
  version.review_reasons.length > 0 && version.checked_at === null;

/** The notice as a paragraph, or nothing when the version needs no check. */
export const reviewNotice = (version: Checked) =>
  needsCheck(version)
    ? `<p class="review-notice">Chapters may be imperfect; a moderator will check.</p>\n`
    : "";
