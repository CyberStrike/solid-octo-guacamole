import { createDb } from "@archive/db";
import type { Context } from "hono";
import { makeAuth, SESSION_COOKIE } from "./auth";
import type { Bindings } from "./env";
import { INVALID_TOKEN, readForm } from "./login";
import { confirmPage, forbiddenPage, serverErrorPage } from "./pages";
import type { SecurityVariables } from "./security";
import { isSameOrigin, safeNext } from "./signin";

type ConfirmContext = Context<{ Bindings: Bindings; Variables: SecurityVariables }>;

/**
 * `GET /login/confirm`: the emailed link. It shows a button and uses nothing up
 * (ARCHITECTURE, Auth). The link's query is anyone's to write, so `next` is
 * reduced again here.
 */
export function showConfirm(c: ConfirmContext) {
  const token = c.req.query("token") ?? "";
  if (token === "") return c.redirect(REFUSED, 302);
  return c.html(confirmPage(token, safeNext(c.req.query("next") ?? null)), 200, {
    // The token is in the URL: keep it out of caches and out of any Referer.
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
}

/**
 * `POST /login/confirm`: spends the token and signs in. As on `POST /login`, our
 * route makes the checks `auth.api` calls skip: the origin, before the body is
 * read, and `next`, reduced to a same-site path whatever the form says.
 */
export async function confirmSignIn(c: ConfirmContext) {
  if (!isSameOrigin(c.req.raw.headers)) return c.html(forbiddenPage(), 403);

  // A body too large to be our form has no token either.
  const form = (await readForm(c.req.raw)) ?? new URLSearchParams();
  const token = form.get("token") ?? "";
  if (token === "") return c.redirect(REFUSED, 303);

  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  try {
    const verified = await makeAuth(c.env, db).api.magicLinkVerify({
      query: {
        token,
        callbackURL: safeNext(form.get("next")),
        errorCallbackURL: "/login",
      },
      headers: c.req.raw.headers,
      asResponse: true,
    });
    return answerVerified(verified) ?? c.html(serverErrorPage(), 500);
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
}

/** Where a used, expired or unknown link is sent: `showSignIn` says why. `next` is dropped. */
export const REFUSED = `/login?error=${INVALID_TOKEN}`;

/**
 * Our answer to Better Auth's verify response. Signed in: its redirect, with its
 * cookie, as a 303, since a POST is answered with a GET. A used, expired or
 * unknown link: a 303 to `REFUSED`, never Better Auth's own error redirect. Null
 * for anything else, such as failing to create the user or the session: a fault
 * of ours, not the link's.
 */
export function answerVerified(verified: Response): Response | null {
  if (verified.status !== 302) return null;
  if (verified.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))) {
    return new Response(null, { status: 303, headers: verified.headers });
  }
  const location = URL.parse(verified.headers.get("location") ?? "");
  if (location?.searchParams.get("error") !== INVALID_TOKEN) return null;
  return new Response(null, { status: 303, headers: { Location: REFUSED } });
}
