// The chapter reader: /works/:id/chapters/:n renders the current version's
// sanitized fragment from R2 inline in the page (ARCHITECTURE, Reading).

import { createDb, getLiveWork } from "@archive/db";
import type { Context } from "hono";
import type { Bindings } from "./env";
import { layout } from "./pages";
import type { SecurityVariables } from "./security";

type ReaderContext = Context<{ Bindings: Bindings; Variables: SecurityVariables }>;

const MAX_INT4 = 2_147_483_647;

/**
 * A work ID or chapter number from a URL: plain ASCII digits with no leading zero,
 * within Postgres's int4. Null for anything else, so `007` is not chapter 7.
 */
const positiveInt = (text: string | undefined) => {
  if (text === undefined || !/^[1-9]\d{0,9}$/.test(text)) return null;
  const value = Number(text);
  return value <= MAX_INT4 ? value : null;
};

export async function showChapter(c: ReaderContext) {
  const id = positiveInt(c.req.param("id"));
  const n = positiveInt(c.req.param("n"));
  if (id === null || n === null) return c.notFound();

  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  let live;
  try {
    live = await getLiveWork(db, id);
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
  const chapter = live?.chapters.find((ch) => ch.n === n);
  if (!live || !chapter) return c.notFound();

  // Chapter HTML comes only from a fragment the sanitizer wrote, under works/: never
  // an upload or an original, whatever the row says.
  if (!chapter.r2_key.startsWith("works/")) return unavailable(c);
  let object: R2ObjectBody | null;
  try {
    object = await c.env.BUCKET.get(chapter.r2_key);
  } catch {
    return unavailable(c);
  }
  if (!object) return unavailable(c);
  // The fragment is trusted markup only because the sanitizer wrote it; it goes in unescaped.
  const fragment = await object.text();

  return c.html(layout(live.work.title, `<article class="chapter">${fragment}</article>`));
}

/** A chapter whose fragment can't be read: empty, uncached, and no detail. */
const unavailable = (c: ReaderContext) => c.body(null, 503, { "Cache-Control": "no-store" });
