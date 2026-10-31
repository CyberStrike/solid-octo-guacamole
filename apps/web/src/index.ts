import { Hono } from "hono";
import {
  adminGate,
  showAdminHome,
  showReports,
  showRequests,
  showTakedowns,
  showWorksToCheck,
  type AdminVariables,
} from "./admin";
import { assetRoute } from "./assets";
import { confirmSignIn, showConfirm } from "./confirm";
import type { Bindings } from "./env";
import { requestSignIn, showSignIn } from "./login";
import { jumpToChapter, showChapter } from "./reader";
import { aboutPage, notFoundPage, privacyPage, termsPage, turnstilePage } from "./pages";
import { closedBeforeLaunch, isPrelaunch } from "./prelaunch";
import {
  contentSecurityPolicy,
  strictTransportSecurity,
  wwwToBareDomain,
  type SecurityVariables,
} from "./security";
import { sessionMiddleware, type SessionVariables } from "./session";
import { STYLESHEET, STYLESHEET_PATH } from "./styles";
import { joinWaitlist } from "./waitlist";
import { comingSoonPage } from "./waitlist-pages";
import { showWork } from "./work-page";

const app = new Hono<{
  Bindings: Bindings;
  Variables: SecurityVariables & SessionVariables & AdminVariables;
}>();

// Order matters: HSTS covers everything, the www redirect included, and www
// never reaches the CSP, the routes or anything that could set a cookie. Before
// launch, closed pages are redirected next, so they carry HSTS but never a page.
app.use(strictTransportSecurity);
app.use(wwwToBareDomain);
app.use(closedBeforeLaunch);
app.use(contentSecurityPolicy);

// The moderation area. "/admin/*" matches /admin itself too, and every path below
// it, routed or not, so a later /admin route is gated without asking. Until A4
// mounts the session for every page, it is mounted here for /admin only.
app.use("/admin/*", sessionMiddleware, adminGate);
app.get("/admin", showAdminHome);
app.get("/admin/reports", showReports);
app.get("/admin/takedowns", showTakedowns);
app.get("/admin/requests", showRequests);
app.get("/admin/works", showWorksToCheck);

// The wait list pages' fonts and stylesheet. S1 serves its own stylesheet elsewhere under /assets/.
app.get("/assets/waitlist/*", assetRoute);

// The coming-soon page before launch. After it there is no home page yet.
app.get("/", (c) =>
  isPrelaunch(c.env)
    ? c.html(comingSoonPage(c.get("nonce"), c.env.TURNSTILE_SITE_KEY))
    : c.notFound(),
);
app.get("/login", showSignIn);
app.post("/login", requestSignIn);
app.get("/login/confirm", showConfirm);
app.post("/login/confirm", confirmSignIn);
app.post("/waitlist", joinWaitlist);
// After launch, a stale link to the form goes home. Before it, nothing is at GET /waitlist.
app.get("/waitlist", (c) => (isPrelaunch(c.env) ? c.notFound() : c.redirect("/", 302)));
app.get("/upload", (c) => c.html(turnstilePage("Upload a work", c.get("nonce"))));
app.get("/remove", (c) => c.html(turnstilePage("Request removal", c.get("nonce"))));

// The reader. Closed before launch, like every /works/ page.
app.get("/works/:id/chapters/:n", showChapter);
app.get("/works/:id/chapters", jumpToChapter);

app.get("/about", (c) => c.html(aboutPage()));
app.get("/terms", (c) => c.html(termsPage()));
app.get("/privacy", (c) => c.html(privacyPage()));

app.get("/works/:id", showWork);

// The URL carries a hash of the content, so the response never changes under it.
app.get(STYLESHEET_PATH, (c) =>
  c.body(STYLESHEET, 200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  }),
);

app.notFound((c) => c.html(notFoundPage(), 404));
// Hono's default logs the whole error, and one from Postgres can quote the row it
// failed on, a sign-in address included. Log only what kind of error it was.
app.onError((error, c) => {
  console.error(`${c.req.method} ${c.req.path}: ${error.name}`);
  return c.text("Internal Server Error", 500);
});

export default app;
