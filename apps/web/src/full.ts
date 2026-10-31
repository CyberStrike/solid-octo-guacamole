// The entire work on one page: /works/:id/full streams every chapter's sanitized
// fragment from R2, in order, into one page (ARCHITECTURE, Reading). It streams so a
// long work never sits in the isolate's memory: one chunk at a time per reader.

import { createDb, getLiveWork } from "@archive/db";
import { escapeHtml, layoutAround } from "./pages";
import {
  chapterTitle,
  isFragmentKey,
  positiveInt,
  unavailable,
  type ReaderContext,
} from "./reader";
import { reviewNotice } from "./review-notice";

/** A fragment's bytes, or null when the key is missing. Anything with R2's `get`. */
export interface FragmentBucket {
  get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null>;
}

/** One chapter fragment's body from R2, unread. R7's cache goes in here. */
export const openFragment = async (bucket: FragmentBucket, key: string) =>
  (await bucket.get(key))?.body ?? null;

/**
 * A piece of the page: our own markup, a fragment body already opened, or one to open
 * when the reader reaches it.
 */
export type Part =
  | string
  | ReadableStream<Uint8Array>
  | (() => Promise<ReadableStream<Uint8Array> | null>);

/**
 * The parts as one byte stream, opened one at a time and only as the reader pulls, so a
 * reader who leaves stops the R2 reads. Fragment bytes pass through as they are; only
 * our markup is encoded. A fragment that is missing or fails ends the stream in an
 * error: the 200 is already out, and a truncated page is better than a wrong one.
 */
export function streamParts(parts: Part[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let next = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // Each pull enqueues at least one chunk, or closes.
        for (;;) {
          if (reader) {
            const { done, value } = await reader.read();
            if (!done) return controller.enqueue(value);
            reader = null;
          }
          const part = parts[next++];
          if (part === undefined) return controller.close();
          if (!(part instanceof ReadableStream || part instanceof Function)) {
            return controller.enqueue(encoder.encode(part));
          }
          const body = part instanceof ReadableStream ? part : await part();
          if (!body) throw new Error("A fragment is missing");
          reader = body.getReader();
        }
      } catch (error) {
        // The kind of error only: never the key, which names the work.
        console.error(`Entire work stream: ${error instanceof Error ? error.name : "unknown"}`);
        controller.error(error);
      }
    },
    async cancel(reason) {
      // The open body, and any opened ahead that the reader never reached.
      await reader?.cancel(reason);
      for (const part of parts.slice(next)) {
        if (part instanceof ReadableStream) await part.cancel(reason);
      }
    },
  });
}

export async function showFull(c: ReaderContext) {
  const id = positiveInt(c.req.param("id"));
  if (id === null) return c.notFound();

  // One query, so one connection. A hidden or removed work's answer goes here (R3).
  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString, max: 1 });
  let live;
  try {
    live = await getLiveWork(db, id);
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
  if (!live) return c.notFound();

  // Chapter HTML comes only from fragments the sanitizer wrote, under works/ and this
  // version's own prefix. Every key is checked before anything is read or sent.
  const { chapters, version } = live;
  if (
    chapters.some(
      (ch) => !ch.r2_key.startsWith("works/") || !isFragmentKey(ch.r2_key, id, version.r2_prefix),
    )
  ) {
    return unavailable(c);
  }
  // The first chapter is read before the 200, so R2 being down is a clean 503.
  let first: ReadableStream<Uint8Array> | null = null;
  if (chapters[0]) {
    try {
      first = await openFragment(c.env.BUCKET, chapters[0].r2_key);
    } catch {
      return unavailable(c);
    }
    if (!first) return unavailable(c);
  }

  const workTitle = live.work.title.trim() || "Untitled work";
  const { before, after } = layoutAround(`${workTitle}, entire work`, "", bar(workTitle));
  // The fragments are trusted markup only because the sanitizer wrote them; they go in
  // unescaped. The chapter headings' ids stay stable: links may point at them.
  const parts: Part[] = [`${before}${reviewNotice(version)}`];
  chapters.forEach((ch, i) => {
    parts.push(
      `<h2 class="chapter-title" id="chapter-${ch.n}">${escapeHtml(chapterTitle(ch))}</h2>\n<article class="chapter">`,
      i === 0 && first ? first : () => openFragment(c.env.BUCKET, ch.r2_key),
      `</article>\n`,
    );
  });
  parts.push(`<p class="back"><a href="/works/${id}">Back to the work page</a></p>${after}`);
  return c.body(streamParts(parts), 200, { "Content-Type": "text/html; charset=UTF-8" });
}

/** The slim top bar, as on a chapter page: the work title, the page's one h1, and settings. */
const bar = (workTitle: string) =>
  `<div class="reader-bar"><h1>${escapeHtml(workTitle)}</h1><a href="/settings/reader">Reader settings</a></div>`;
