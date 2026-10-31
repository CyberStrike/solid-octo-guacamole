import { Hono } from "hono";
import type { Env } from "./env";
import { requestSignIn, showSignIn } from "./login";
import { notFoundPage, turnstilePage } from "./pages";
import {
  contentSecurityPolicy,
  strictTransportSecurity,
  wwwToBareDomain,
  type SecurityVariables,
} from "./security";

const app = new Hono<{ Bindings: Env; Variables: SecurityVariables }>();

// Order matters: HSTS covers everything, the www redirect included, and www
// never reaches the CSP, the routes or anything that could set a cookie.
app.use(strictTransportSecurity);
app.use(wwwToBareDomain);
app.use(contentSecurityPolicy);

app.get("/login", showSignIn);
app.post("/login", requestSignIn);
app.get("/upload", (c) => c.html(turnstilePage("Upload a work", c.get("nonce"))));
app.get("/remove", (c) => c.html(turnstilePage("Request removal", c.get("nonce"))));

app.notFound((c) => c.html(notFoundPage(), 404));
// Hono's default logs the whole error, and one from Postgres can quote the row it
// failed on, a sign-in address included. Log only what kind of error it was.
app.onError((error, c) => {
  console.error(`${c.req.method} ${c.req.path}: ${error.name}`);
  return c.text("Internal Server Error", 500);
});

export default app;
