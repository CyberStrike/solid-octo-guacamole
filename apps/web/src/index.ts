import { Hono } from "hono";
import type { Env } from "./env";
import { notFoundPage, signInPage, turnstilePage } from "./pages";
import {
  contentSecurityPolicy,
  strictTransportSecurity,
  wwwToBareDomain,
  type SecurityVariables,
} from "./security";
import { safeNext } from "./signin";

const app = new Hono<{ Bindings: Env; Variables: SecurityVariables }>();

// Order matters: HSTS covers everything, the www redirect included, and www
// never reaches the CSP, the routes or anything that could set a cookie.
app.use(strictTransportSecurity);
app.use(wwwToBareDomain);
app.use(contentSecurityPolicy);

app.get("/login", (c) =>
  c.html(
    signInPage(c.get("nonce"), {
      siteKey: c.env.TURNSTILE_SITE_KEY,
      next: safeNext(c.req.query("next") ?? null),
    }),
  ),
);
app.get("/upload", (c) => c.html(turnstilePage("Upload a work", c.get("nonce"))));
app.get("/remove", (c) => c.html(turnstilePage("Request removal", c.get("nonce"))));

app.notFound((c) => c.html(notFoundPage(), 404));

export default app;
