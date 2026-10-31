import type { Handler } from "hono";
import type { Bindings } from "./prelaunch";

// A name with the first 16 hex of the file's SHA-256 never changes content.
const CONTENT_HASHED = /\.[0-9a-f]{16}\.[a-z0-9]+$/;

/**
 * Serves a file from public/ through the ASSETS binding, so the response passes the
 * app's middleware like any other (HSTS; www never gets here). Content-hashed files
 * are cached for a year; the rest keep the binding's revalidate-every-time header.
 */
export const assetRoute: Handler<{ Bindings: Bindings }> = async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status === 404) return c.notFound();
  // A copy, as the binding's response headers may be immutable.
  const headers = new Headers(res.headers);
  if (res.ok && CONTENT_HASHED.test(c.req.path)) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(res.body, { status: res.status, headers });
};
