// The moderation area under /admin (FRONTEND-DISCOVERY, Moderation queues): the gate
// every /admin URL goes through, and the four queues, read only. Actions and detail
// pages come with later tickets (MOD2 on).

import { createDb } from "@archive/db";
import type { Context, MiddlewareHandler } from "hono";
import {
  adminHomePage,
  QUEUE_LIMIT,
  queuePage,
  REPORT_COLUMNS,
  REQUEST_COLUMNS,
  TAKEDOWN_COLUMNS,
  WORK_COLUMNS,
  type Row,
} from "./admin-pages";
import type { Bindings } from "./env";
import type { SecurityVariables } from "./security";
import type { SessionVariables } from "./session";

/** The roles with every moderator power (ARCHITECTURE, Data model): an admin has them too. */
export type ModeratorRole = "moderator" | "admin";

export type AdminVariables = { role: ModeratorRole };

type AdminEnv = {
  Bindings: Bindings;
  Variables: SecurityVariables & SessionVariables & AdminVariables;
};

/**
 * Sets `Cache-Control: no-store` on every /admin response: the queues hold contact
 * emails and statements, which no cache keeps.
 */
export const adminGate: MiddlewareHandler<AdminEnv> = async (c, next) => {
  await next();
  // After the handler: its own Response doesn't keep headers set before it.
  c.header("Cache-Control", "no-store");
};

type AdminContext = Context<AdminEnv>;

/** Runs `query` on a database of its own, closed once the response is sent. */
async function withDb<T>(c: AdminContext, query: (db: ReturnType<typeof createDb>) => Promise<T>) {
  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  try {
    return await query(db);
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
}

const iso = (date: Date) => date.toISOString();

/** "Title (AO3 ID)", for a queue's work column. */
const workCell = (title: string, ao3WorkId: number) => `${title} (${ao3WorkId})`;

/** `GET /admin`: links to the four queues. */
export const showAdminHome = (c: AdminContext) => c.html(adminHomePage());

/** `GET /admin/reports`: open reports. */
export async function showReports(c: AdminContext) {
  const rows = await withDb(c, (db) =>
    db
      .selectFrom("reports")
      .innerJoin("works", "works.id", "reports.work_id")
      .select([
        "reports.created_at",
        "reports.kind",
        "reports.body",
        "works.title",
        "works.ao3_work_id",
      ])
      .where("reports.status", "=", "open")
      .orderBy("reports.created_at")
      .orderBy("reports.id")
      .limit(QUEUE_LIMIT + 1)
      .execute(),
  );
  const cells = rows.map((r): Row => [
    iso(r.created_at),
    workCell(r.title, r.ao3_work_id),
    r.kind,
    r.body ?? "",
  ]);
  return c.html(queuePage("Reports", REPORT_COLUMNS, cells));
}

/** `GET /admin/takedowns`: pending DMCA notices. */
export async function showTakedowns(c: AdminContext) {
  const rows = await withDb(c, (db) =>
    db
      .selectFrom("takedowns")
      .innerJoin("works", "works.id", "takedowns.work_id")
      .select([
        "takedowns.created_at",
        "takedowns.requester",
        "takedowns.basis",
        "works.title",
        "works.ao3_work_id",
      ])
      .where("takedowns.status", "=", "pending")
      .orderBy("takedowns.created_at")
      .orderBy("takedowns.id")
      .limit(QUEUE_LIMIT + 1)
      .execute(),
  );
  const cells = rows.map((r): Row => [
    iso(r.created_at),
    workCell(r.title, r.ao3_work_id),
    r.requester,
    r.basis,
  ]);
  return c.html(queuePage("Takedowns", TAKEDOWN_COLUMNS, cells));
}

/** `GET /admin/requests`: pending removal and opt-out requests, both kinds. */
export async function showRequests(c: AdminContext) {
  const rows = await withDb(c, (db) =>
    db
      .selectFrom("requests")
      // An opt-out names a pseud, not a work.
      .leftJoin("works", "works.id", "requests.work_id")
      .select([
        "requests.created_at",
        "requests.kind",
        "requests.pseud_norm",
        "requests.contact_email",
        "requests.statement",
        "works.title",
        "works.ao3_work_id",
      ])
      .where("requests.status", "=", "pending")
      .orderBy("requests.created_at")
      .orderBy("requests.id")
      .limit(QUEUE_LIMIT + 1)
      .execute(),
  );
  const cells = rows.map((r): Row => [
    iso(r.created_at),
    r.kind,
    r.title === null || r.ao3_work_id === null
      ? (r.pseud_norm ?? "")
      : workCell(r.title, r.ao3_work_id),
    r.contact_email,
    r.statement,
  ]);
  return c.html(queuePage("Requests", REQUEST_COLUMNS, cells));
}

/** `GET /admin/works`: Works to check. MOD3 (#47) fills it; for now it is always empty. */
export function showWorksToCheck(c: AdminContext) {
  return c.html(queuePage("Works to check", WORK_COLUMNS, []));
}
