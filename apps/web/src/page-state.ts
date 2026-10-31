// What a reader's cookies add to every app page, whichever handler built it: the
// reader settings as attributes on <html> (ARCHITECTURE, Reading), and the flash a
// POST left for the page its redirect lands on. No handler or layout() call has to
// remember either.

import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import {
  CLEAR_FLASH_COOKIE,
  dataAttributes,
  FLASH_COOKIE,
  flashMessage,
  parseSettings,
  SETTINGS_COOKIE,
} from "./reader-settings";

/**
 * Rewrites each successful HTML page on its way out. Runs inside the CSP middleware,
 * which keys on the content type this keeps. A page with neither cookie passes
 * through untouched.
 */
export const pageState: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.res.status !== 200) return;
  if (!c.res.headers.get("content-type")?.toLowerCase().startsWith("text/html")) return;

  const attributes = dataAttributes(parseSettings(getCookie(c, SETTINGS_COOKIE)));
  // Only a GET shows the flash, since showing it uses it up. Its copy comes from our
  // table, never from the cookie.
  const flash = c.req.method === "GET" ? flashMessage(getCookie(c, FLASH_COOKIE)) : null;
  if (attributes.length === 0 && flash === null) return;

  let seenHtml = false;
  const rewriter = new HTMLRewriter().on("html", {
    element(html) {
      // The document's own <html> is the first; nothing in a page comes before it.
      if (seenHtml) return;
      seenHtml = true;
      for (const [name, value] of attributes) html.setAttribute(name, value);
    },
  });
  // With no flash to show, the page streams through.
  if (flash === null) {
    c.res = rewriter.transform(c.res);
    return;
  }

  // SAFETY: the banner handler below sets it, which TypeScript can't see from here.
  let flashShown = false as boolean;
  rewriter.on("aside.banner", {
    element(banner) {
      // The layout's banner comes before main, so a fragment's look-alike never wins.
      if (flashShown) return;
      flashShown = true;
      banner.after(`\n<p class="flash" role="status">${flash}</p>`, { html: true });
    },
  });
  // Read to the end, so we know whether the page had a banner to put the flash under
  // before the headers go out. A page without one leaves the flash for the next.
  const body = await rewriter.transform(c.res).text();
  c.res = new Response(body, c.res);
  if (flashShown) {
    c.header("Set-Cookie", CLEAR_FLASH_COOKIE, { append: true });
    c.header("Cache-Control", "no-store");
  }
};
