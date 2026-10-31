import { createDb } from "@archive/db";
import { isAPIError } from "better-auth/api";
import type { Context } from "hono";
import { makeAuth } from "./auth";
import type { Env } from "./env";
import { checkEmailPage, forbiddenPage, signInPage } from "./pages";
import type { SecurityVariables } from "./security";
import { isSameOrigin, safeNext } from "./signin";
import { verifyTurnstile } from "./turnstile";

type LoginContext = Context<{ Bindings: Env; Variables: SecurityVariables }>;

/** `GET /login`: the sign-in form, carrying the page to come back to. */
export const showSignIn = (c: LoginContext) =>
  c.html(
    signInPage(c.get("nonce"), {
      siteKey: c.env.TURNSTILE_SITE_KEY,
      next: safeNext(c.req.query("next") ?? null),
    }),
  );

/** The fields of a plain form post. Anything else, such as a multipart body, has none. */
async function readForm(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return new URLSearchParams();
  }
  return new URLSearchParams(await request.text());
}

/**
 * `POST /login`: emails a sign-in link. Our route makes the checks `auth.api`
 * calls skip (ARCHITECTURE, Auth): the origin, before the body is read; then
 * Turnstile; then `next`, reduced to a same-site path.
 */
export async function requestSignIn(c: LoginContext) {
  if (!isSameOrigin(c.req.raw.headers)) return c.html(forbiddenPage(), 403);

  const form = await readForm(c.req.raw);
  const email = form.get("email") ?? "";
  const next = safeNext(form.get("next"));
  const formAgain = (status: 400 | 503, error: string) =>
    c.html(
      signInPage(c.get("nonce"), { siteKey: c.env.TURNSTILE_SITE_KEY, next, email, error }),
      status,
    );

  const turnstile = await verifyTurnstile(form.get("cf-turnstile-response"), {
    secret: c.env.TURNSTILE_SECRET_KEY,
    hostname: new URL(c.req.url).hostname,
    remoteIp: c.req.header("cf-connecting-ip") ?? null,
  });
  if (turnstile === "failed") {
    return formAgain(400, "The anti-spam check didn't pass. Please try again.");
  }
  if (turnstile === "unavailable") {
    return formAgain(503, "The anti-spam check isn't answering just now. Please try again.");
  }

  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  try {
    await makeAuth(c.env, db).api.signInMagicLink({
      body: { email, callbackURL: next, metadata: { next } },
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
