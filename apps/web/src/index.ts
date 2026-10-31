import { Hono } from "hono";
import { assetRoute } from "./assets";
import { notFoundPage, turnstilePage } from "./pages";
import { isPrelaunch, type Bindings } from "./prelaunch";
import {
  contentSecurityPolicy,
  strictTransportSecurity,
  wwwToBareDomain,
  type SecurityVariables,
} from "./security";
import { comingSoonPage } from "./waitlist-pages";

const app = new Hono<{ Bindings: Bindings; Variables: SecurityVariables }>();

// Order matters: HSTS covers everything, the www redirect included, and www
// never reaches the CSP, the routes or anything that could set a cookie.
app.use(strictTransportSecurity);
app.use(wwwToBareDomain);
app.use(contentSecurityPolicy);

// The wait list pages' fonts and stylesheet. S1's stylesheet has its own route beside it.
app.get("/assets/waitlist/*", assetRoute);

// The coming-soon page before launch. After it there is no home page yet.
app.get("/", (c) =>
  isPrelaunch(c.env)
    ? c.html(comingSoonPage(c.get("nonce"), c.env.TURNSTILE_SITE_KEY))
    : c.notFound(),
);
app.get("/login", (c) => c.html(turnstilePage("Sign in", c.get("nonce"))));
app.get("/upload", (c) => c.html(turnstilePage("Upload a work", c.get("nonce"))));
app.get("/remove", (c) => c.html(turnstilePage("Request removal", c.get("nonce"))));

app.notFound((c) => c.html(notFoundPage(), 404));

export default app;
