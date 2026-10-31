import { createDb } from "@archive/db";
import { isAPIError } from "better-auth/api";
import type { Context } from "hono";
import { makeAuth } from "./auth";
import type { Env } from "./env";
import { checkEmailPage, forbiddenPage, signInPage } from "./pages";
import type { SecurityVariables } from "./security";
import { isSameOrigin, safeNext } from "./signin";
import { verifyTurnstile } from "./turnstile";

// The longest address an email can be sent to (RFC 5321), as apps/mailer checks.
const MAX_EMAIL = 254;

type LoginContext = Context<{ Bindings: Env; Variables: SecurityVariables }>;

/** `GET /login`: the sign-in form, carrying the page to come back to. */
export const showSignIn = (c: LoginContext) =>
  c.html(
    signInPage(c.get("nonce"), {
      siteKey: c.env.TURNSTILE_SITE_KEY,
      next: safeNext(c.req.query("next") ?? null),
    }),
  );

// The sign-in form at its largest: a 254-character address, a 512-character next and
// a 2048-character token, percent-encoded, come to under 5 KB.
const MAX_BODY = 8 * 1024;

/**
 * The fields of a plain form post, or null when the body is over `MAX_BODY`
 * bytes, which stops being read there. Anything else, such as a multipart body,
 * has no fields.
 */
async function readForm(request: Request): Promise<URLSearchParams | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return new URLSearchParams();
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return null;
  if (request.body === null) return new URLSearchParams();

  // Counted as it arrives, since a streamed body declares no length.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(read.value);
  }
  return new URLSearchParams(await new Blob(chunks).text());
}

/**
 * `POST /login`: emails a sign-in link. Our route makes the checks `auth.api`
 * calls skip (ARCHITECTURE, Auth): the origin, before the body is read; then
 * Turnstile; then `next`, reduced to a same-site path.
 */
export async function requestSignIn(c: LoginContext) {
  if (!isSameOrigin(c.req.raw.headers)) return c.html(forbiddenPage(), 403);

  const form = await readForm(c.req.raw);
  if (form === null) {
    // Nothing of it is shown back: the form comes again empty.
    const error = "That request was too large. Please try again.";
    return c.html(
      signInPage(c.get("nonce"), { siteKey: c.env.TURNSTILE_SITE_KEY, next: "/", error }),
      413,
    );
  }
  const email = form.get("email") ?? "";
  const next = safeNext(form.get("next"));
  // What was typed comes back in the form, unless it's too long to be an address.
  const typed = email.length > MAX_EMAIL ? "" : email;
  const formAgain = (status: 400 | 503, error: string) =>
    c.html(
      signInPage(c.get("nonce"), {
        siteKey: c.env.TURNSTILE_SITE_KEY,
        next,
        email: typed,
        error,
      }),
      status,
    );

  const turnstile = await verifyTurnstile(form.get("cf-turnstile-response"), {
    secret: c.env.TURNSTILE_SECRET_KEY,
    hostname: new URL(c.req.url).hostname,
    remoteIp: c.req.header("cf-connecting-ip") ?? null,
  });
  if (turnstile === "failed") {
    return formAgain(400, "The anti-spam check did not pass. Please try again.");
  }
  if (turnstile === "unavailable") {
    return formAgain(
      503,
      "The anti-spam check is not answering just now. Please try again in a minute.",
    );
  }

  // The mailer sends to no address longer than this, so no token is made for one.
  if (email.length > MAX_EMAIL) return formAgain(400, "Enter a valid email address.");

  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  try {
    await makeAuth(c.env, db).api.signInMagicLink({
      // `next` reaches the link through metadata (auth.ts); Better Auth's own
      // callbackURL is for its verify endpoint, which isn't mounted.
      body: { email, metadata: { next } },
      headers: c.req.raw.headers,
    });
  } catch (error) {
    // Better Auth refuses an address that isn't one with a 400. Anything else is ours.
    if (isAPIError(error) && error.statusCode === 400) {
      return formAgain(400, "Enter a valid email address.");
    }
    throw error;
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
  return c.html(checkEmailPage());
}
