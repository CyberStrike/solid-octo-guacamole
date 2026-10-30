import { Hono } from "hono";
import { notFoundPage, turnstilePage } from "./pages";
import {
  contentSecurityPolicy,
  strictTransportSecurity,
  wwwToBareDomain,
  type SecurityVariables,
} from "./security";

const app = new Hono<{ Variables: SecurityVariables }>();

// Order matters: HSTS covers everything, the www redirect included, and www
// never reaches the CSP, the routes or anything that could set a cookie.
app.use(strictTransportSecurity);
app.use(wwwToBareDomain);
app.use(contentSecurityPolicy);

app.get("/login", (c) => c.html(turnstilePage("Sign in", c.get("nonce"))));
app.get("/upload", (c) => c.html(turnstilePage("Upload a work", c.get("nonce"))));
app.get("/remove", (c) => c.html(turnstilePage("Request removal", c.get("nonce"))));

app.notFound((c) => c.html(notFoundPage(), 404));

export default app;
