// What a reader's cookies add to every app page, whichever handler built it: the
// reader settings as attributes on <html> (ARCHITECTURE, Reading). No handler or
// layout() call has to remember them.

import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { dataAttributes, parseSettings, SETTINGS_COOKIE } from "./reader-settings";

/**
 * Rewrites each successful HTML page on its way out. Runs inside the CSP middleware,
 * which keys on the content type this keeps. A page with no settings cookie passes
 * through untouched.
 */
export const pageState: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.res.status !== 200) return;
  if (!c.res.headers.get("content-type")?.toLowerCase().startsWith("text/html")) return;

  const attributes = dataAttributes(parseSettings(getCookie(c, SETTINGS_COOKIE)));
  if (attributes.length === 0) return;

  let done = false;
  c.res = new HTMLRewriter()
    .on("html", {
      element(html) {
        // The document's own <html> is the first; nothing in a page can come before it.
        if (done) return;
        done = true;
        for (const [name, value] of attributes) {
          html.setAttribute(name, value);
        }
      },
    })
    .transform(c.res);
};
