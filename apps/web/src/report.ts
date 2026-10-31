// The report form, `/works/:id/report`, where :id is the AO3 work ID. Reporting
// needs an account (ARCHITECTURE, Author requests & takedowns, Reports). No
// script and no Turnstile, so it works with JavaScript off.

import { createDb } from "@archive/db";
import type { Context } from "hono";
import type { Bindings } from "./env";
import { escapeHtml, layout } from "./pages";
import type { SecurityVariables } from "./security";
import type { SessionVariables } from "./session";

type ReportContext = Context<{
  Bindings: Bindings;
  Variables: SecurityVariables & SessionVariables;
}>;

type Db = ReturnType<typeof createDb>;

const MAX_INT4 = 2_147_483_647;

/**
 * The reasons a reader can give, by the `kind` stored. Only `wrong_version` is
 * named in the docs: moderators' *Works to check* and the auto-hide count read it
 * by that string. The labels are draft copy.
 */
const REASONS = {
  wrong_version: "This version is wrong",
  harmful_content: "It breaks the rules or is harmful",
  not_this_work: "It isn't the work it says it is",
  other: "Something else",
} as const;

/** An AO3 work ID from the URL: plain decimal digits, within Postgres's int4. */
function workId(text: string | undefined): number | null {
  if (text === undefined || !/^[1-9]\d{0,9}$/.test(text)) return null;
  const value = Number(text);
  return value <= MAX_INT4 ? value : null;
}

/** A live work, as the work page would show it, or undefined. Hidden and removed works are not found. */
const liveWork = (db: Db, ao3WorkId: number) =>
  db
    .selectFrom("works")
    .select(["id", "title"])
    .where("ao3_work_id", "=", ao3WorkId)
    .where("status", "=", "live")
    .where("current_version_id", "is not", null)
    .executeTakeFirst();

/** The form. `ao3WorkId` is a number, so safe in an href. Every other value is escaped. */
const reportPage = (ao3WorkId: number, title: string) =>
  layout(
    "Report a work",
    `<p class="draft">Draft: this text has not been proofread yet.</p>
<p>Tell the moderators what is wrong with <a href="/works/${ao3WorkId}">${escapeHtml(title)}</a>.</p>
<form method="post" action="/works/${ao3WorkId}/report">
<fieldset>
<legend>Reason</legend>
${Object.entries(REASONS)
  .map(
    ([kind, label]) =>
      `<label><input type="radio" name="reason" value="${kind}"> ${escapeHtml(label)}</label>`,
  )
  .join("\n")}
</fieldset>
<label for="details">Details (optional, up to 2000 characters)</label>
<textarea id="details" name="details" rows="6" maxlength="2000"></textarea>
<button type="submit">Send report</button>
</form>`,
  );

/** `GET /works/:id/report`: the form, for a signed-in reader. */
export async function showReportForm(c: ReportContext) {
  const id = workId(c.req.param("id"));
  if (id === null) return c.notFound();
  if (c.var.session === null)
    return c.redirect(`/login?next=${encodeURIComponent(`/works/${id}/report`)}`, 302);
  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  try {
    const work = await liveWork(db, id);
    if (!work) return c.notFound();
    return c.html(reportPage(id, work.title));
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
}
