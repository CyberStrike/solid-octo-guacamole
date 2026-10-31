import { createDb } from "@archive/db";
import type { Context } from "hono";
import { makeAuth } from "./auth";
import type { Bindings } from "./env";
import { readForm } from "./login";
import { confirmPage, forbiddenPage } from "./pages";
import type { SecurityVariables } from "./security";
import { isSameOrigin, safeNext } from "./signin";

type ConfirmContext = Context<{ Bindings: Bindings; Variables: SecurityVariables }>;

/**
 * `GET /login/confirm`: the emailed link. It shows a button and uses nothing up
 * (ARCHITECTURE, Auth). The link's query is anyone's to write, so `next` is
 * reduced again here.
 */
export const showConfirm = (c: ConfirmContext) =>
  c.html(confirmPage(c.req.query("token") ?? "", safeNext(c.req.query("next") ?? null)), 200, {
    // The token is in the URL: keep it out of caches and out of any Referer.
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });

/**
 * `POST /login/confirm`: spends the token and signs in. As on `POST /login`, our
 * route makes the checks `auth.api` calls skip: the origin, before the body is
 * read, and `next`, reduced to a same-site path whatever the form says.
 */
export async function confirmSignIn(c: ConfirmContext) {
  if (!isSameOrigin(c.req.raw.headers)) return c.html(forbiddenPage(), 403);

  const form = (await readForm(c.req.raw)) ?? new URLSearchParams();
  const db = createDb({ connectionString: c.env.HYPERDRIVE.connectionString });
  try {
    const verified = await makeAuth(c.env, db).api.magicLinkVerify({
      query: {
        token: form.get("token") ?? "",
        callbackURL: safeNext(form.get("next")),
        errorCallbackURL: "/login",
      },
      headers: c.req.raw.headers,
      asResponse: true,
    });
    // A POST answered with a redirect is a 303: the next request is a GET.
    return new Response(null, { status: 303, headers: verified.headers });
  } finally {
    c.executionCtx.waitUntil(db.destroy());
  }
}
