// The report form, `/works/:id/report`, where :id is the AO3 work ID. Reporting
// needs an account (ARCHITECTURE, Author requests & takedowns, Reports). No
// script and no Turnstile, so it works with JavaScript off.

import { createDb } from "@archive/db";
import type { Context } from "hono";
import type { Bindings } from "./env";
import { readForm } from "./login";
import { escapeHtml, forbiddenPage, layout } from "./pages";
import type { SecurityVariables } from "./security";
import type { SessionVariables } from "./session";
import { isSameOrigin } from "./signin";

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

/**
 * Whether the account is banned. Read from the database, not the session: the
 * session's user has no `banned_at`, and a ban must hold at once.
 */
const isBanned = async (db: Db, userId: string) =>
  (await db.selectFrom("user").select("banned_at").where("id", "=", userId).executeTakeFirst())
    ?.banned_at != null;

const bannedPage = () =>
  layout("Report not sent", `<p>You can't send reports from this account.</p>`);

type Kind = keyof typeof REASONS;

const isKind = (value: string): value is Kind => Object.hasOwn(REASONS, value);

/** The longest details kept, in characters, as the form says. */
const MAX_DETAILS = 2000;

interface ReportForm {
  /** Why the form came back. */
  error?: string;
  /** The reason chosen, when the form comes back. */
  kind?: Kind;
  /** What was typed, when the form comes back. */
  details?: string;
}

/** The form. `ao3WorkId` is a number, so safe in an href. Every other value is escaped. */
const reportPage = (ao3WorkId: number, title: string, form: ReportForm = {}) =>
  layout(
    "Report a work",
    `<p class="draft">Draft: this text has not been proofread yet.</p>
${form.error === undefined ? "" : `<p role="alert">${escapeHtml(form.error)}</p>\n`}<p>Tell the moderators what is wrong with <a href="/works/${ao3WorkId}">${escapeHtml(title)}</a>.</p>
<form method="post" action="/works/${ao3WorkId}/report">
<fieldset>
<legend>Reason</legend>
${Object.entries(REASONS)
  .map(
    ([kind, label]) =>
      `<label><input type="radio" name="reason" value="${kind}"${kind === form.kind ? " checked" : ""}> ${escapeHtml(label)}</label>`,
  )
  .join("\n")}
</fieldset>
<label for="details">Details (optional, up to ${MAX_DETAILS} characters)</label>
<textarea id="details" name="details" rows="6" maxlength="${MAX_DETAILS}">${escapeHtml(form.details ?? "")}</textarea>
<button type="submit">Send report</button>
</form>`,
  );

/** The sign-in form, coming back to work `id`'s report form after. */
const signInFirst = (id: number) => `/login?next=${encodeURIComponent(`/works/${id}/report`)}`;

/**
 * What happens next. It says nothing of how many reports hide a work, which would
 * help anyone gaming it. Draft copy.
 */
const reportedPage = () =>
  layout(
    "Report sent",
    `<p class="draft">Draft: this text has not been proofread yet.</p>
<p>Thank you. A moderator will look at it. Your report is kept with your account.</p>
<p>A work several readers report may be hidden until a moderator has looked at it.</p>`,
  );

/** `GET /works/:id/report`: the form, for a signed-in reader. */
export async function showReportForm(c: ReportContext) {
  const id = workId(c.req.param("id"));
  if (id === null) return c.notFound();
  const session = c.var.session;
  if (session === null) return c.redirect(signInFirst(id), 302);
  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  try {
    const work = await liveWork(db, id);
    if (!work) return c.notFound();
    if (await isBanned(db, session.user.id)) return c.html(bannedPage(), 403);
    return c.html(reportPage(id, work.title));
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
}

/**
 * `POST /works/:id/report`: stores an open report. As on the sign-in forms, the
 * origin is checked before anything else, and a signed-out post is sent to sign
 * in before its body is read.
 */
export async function submitReport(c: ReportContext) {
  if (!isSameOrigin(c.req.raw.headers)) return c.html(forbiddenPage(), 403);
  const id = workId(c.req.param("id"));
  if (id === null) return c.notFound();
  const session = c.var.session;
  if (session === null) return c.redirect(signInFirst(id), 303);

  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  try {
    const work = await liveWork(db, id);
    if (!work) return c.notFound();
    if (await isBanned(db, session.user.id)) return c.html(bannedPage(), 403);

    const form = (await readForm(c.req.raw)) ?? new URLSearchParams();
    const reason = form.get("reason") ?? "";
    const details = form.get("details") ?? "";
    // The server checks, since the page has no script and a form can be posted by hand.
    const kind = isKind(reason) ? reason : undefined;
    const error =
      kind === undefined
        ? "Choose a reason."
        : details.length > MAX_DETAILS
          ? `Details can be up to ${MAX_DETAILS} characters.`
          : undefined;
    if (kind === undefined || error !== undefined) {
      return c.html(reportPage(id, work.title, { error, kind, details }), 400);
    }
    await db
      .insertInto("reports")
      .values({
        work_id: work.id,
        reporter_id: session.user.id,
        kind,
        // Optional: details left empty, or only spaces, are none.
        body: details.trim() === "" ? null : details,
      })
      .execute();
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
  return c.html(reportedPage(), 200, { "Cache-Control": "no-store" });
}
