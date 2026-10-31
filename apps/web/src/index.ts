import { Hono } from "hono";
import { aboutPage, notFoundPage, privacyPage, termsPage, turnstilePage } from "./pages";
import {
  contentSecurityPolicy,
  strictTransportSecurity,
  wwwToBareDomain,
  type SecurityVariables,
} from "./security";
import { STYLESHEET, STYLESHEET_PATH } from "./styles";

const app = new Hono<{ Variables: SecurityVariables }>();

// Order matters: HSTS covers everything, the www redirect included, and www
// never reaches the CSP, the routes or anything that could set a cookie.
app.use(strictTransportSecurity);
app.use(wwwToBareDomain);
app.use(contentSecurityPolicy);

app.get("/login", (c) => c.html(turnstilePage("Sign in", c.get("nonce"))));
app.get("/upload", (c) => c.html(turnstilePage("Upload a work", c.get("nonce"))));
app.get("/remove", (c) => c.html(turnstilePage("Request removal", c.get("nonce"))));

app.get("/about", (c) => c.html(aboutPage()));
app.get("/terms", (c) => c.html(termsPage()));
app.get("/privacy", (c) => c.html(privacyPage()));

// The URL carries a hash of the content, so the response never changes under it.
app.get(STYLESHEET_PATH, (c) =>
  c.body(STYLESHEET, 200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
  }),
);

app.notFound((c) => c.html(notFoundPage(), 404));

export default app;
