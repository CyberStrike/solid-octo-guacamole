import { createDb, insertUpload } from "@archive/db";
import type { Context } from "hono";
import type { Bindings } from "./env";
import { readForm } from "./login";
import { forbiddenPage, uploadPage } from "./pages";
import { presignPut } from "./presign";
import type { SecurityVariables } from "./security";
import type { SessionVariables } from "./session";
import { isSameOrigin } from "./signin";
import { verifyTurnstile } from "./turnstile";
import { MAX_UPLOAD_BYTES } from "./upload-limit";

// ARCHITECTURE, Ingestion pipeline, step 1. The upload page's script calls
// `POST /uploads` once per file, with a fresh Turnstile token each time, and PUTs
// the file straight to R2: no byte of it passes through this Worker.

type UploadContext = Context<{
  Bindings: Bindings;
  Variables: SecurityVariables & SessionVariables;
}>;

/** The one type a presigned URL accepts (ARCHITECTURE, Ingestion pipeline). */
export const EPUB_TYPE = "application/epub+zip";

/** How long a presigned URL works: 10 minutes. */
export const UPLOAD_URL_SECONDS = 600;

// A declared size in bytes, as the plain decimal form only: Number() alone also
// reads "0x10", "1e3" and " 12". No empty epub exists, so zero isn't one either.
const SIZE = /^[1-9][0-9]*$/;

/** `GET /upload`: the upload page, or sign in first and come back. */
export const showUpload = (c: UploadContext) =>
  c.var.session === null
    ? c.redirect(`/login?next=${encodeURIComponent("/upload")}`, 302)
    : c.html(uploadPage(c.get("nonce"), c.env.TURNSTILE_SITE_KEY));

/**
 * `POST /uploads`: an `uploads` row and a presigned PUT URL for it, as JSON
 * `{ id, url }`, or `{ error }` for the page to show. The body is a plain form:
 * `size`, the declared bytes, and `cf-turnstile-response`.
 */
export async function requestUpload(c: UploadContext) {
  // No cache keeps a reply: a URL in one can write to the bucket.
  const refuse = (status: 400 | 401 | 413 | 503, error: string) =>
    c.json({ error }, status, { "Cache-Control": "no-store" });

  if (!isSameOrigin(c.req.raw.headers)) return c.html(forbiddenPage(), 403);
  // A script can't follow a sign-in redirect, so it gets a 401 to act on.
  const user = c.var.session?.user;
  if (user === undefined) return refuse(401, "Sign in to upload.");
  // U5: the per-user upload rate limit goes here, before the body is read.

  const form = await readForm(c.req.raw);
  if (form === null) return refuse(413, "That request was too large. Please try again.");

  const turnstile = await verifyTurnstile(form.get("cf-turnstile-response"), {
    secret: c.env.TURNSTILE_SECRET_KEY,
    hostname: new URL(c.req.url).hostname,
    remoteIp: c.req.header("cf-connecting-ip") ?? null,
  });
  if (turnstile === "failed") {
    return refuse(400, "The anti-spam check did not pass. Please try again.");
  }
  if (turnstile === "unavailable") {
    return refuse(
      503,
      "The anti-spam check is not answering just now. Please try again in a minute.",
    );
  }

  const size = form.get("size") ?? "";
  if (!SIZE.test(size)) return refuse(400, "The file's size is missing. Please try again.");
  const bytes = Number(size);
  if (bytes > MAX_UPLOAD_BYTES) {
    return refuse(413, "That file is over the 25 MB limit, so it can't be uploaded.");
  }
  // U4: the daily upload quota goes here, after the size is known.

  // The key is ours alone: nothing in it comes from the request.
  const id = crypto.randomUUID();
  const key = `uploads/${id}`;
  // Signed before the row is written, so a signing fault leaves no row behind.
  const url = await presignPut({
    accountId: c.env.R2_ACCOUNT_ID,
    bucket: c.env.R2_BUCKET,
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    key,
    contentType: EPUB_TYPE,
    expiresSeconds: UPLOAD_URL_SECONDS,
    now: new Date(),
  });
  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  try {
    await insertUpload(db, { id, userId: user.id, r2Key: key, bytes });
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
  return c.json({ id, url }, 200, { "Cache-Control": "no-store" });
}
