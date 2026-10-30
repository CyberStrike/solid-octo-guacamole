// Throwaway spike: Better Auth magic link behind our own no-JS form routes.
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";

export interface Env {
  DB: D1Database;
  BASE_URL: string;
  AUTH_SECRET: string;
}

export interface CapturedEmail {
  email: string;
  url: string; // Better Auth's own GET verify link
  confirmUrl: string; // our prefetch-safe confirm page (GET shows a form, POST consumes)
}

// The stubbed mailer writes here. Nothing is sent anywhere.
export const outbox: CapturedEmail[] = [];

// Built per request: Workers bindings only exist on `env`, and per-request
// instances mean Better Auth's in-process consume lock is never shared.
export function makeAuth(env: Env) {
  return betterAuth({
    baseURL: env.BASE_URL,
    secret: env.AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [env.BASE_URL],
    telemetry: { enabled: false },
    // Disabled for the spike: the plugin rule is 5 requests / 60 s on verify and
    // the default memory store is a module-level Map, so tests would hit 429s.
    rateLimit: { enabled: false },
    advanced: {
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      // No crossSubDomainCookies: cookies stay host-only (no Domain=).
    },
    plugins: [
      magicLink({
        storeToken: "hashed",
        expiresIn: 900, // 15 minutes, as ARCHITECTURE § Auth specifies
        sendMagicLink: async ({ email, url, token, metadata }) => {
          const next = typeof metadata?.next === "string" ? metadata.next : "/";
          const confirm = new URL("/auth/confirm", env.BASE_URL);
          confirm.searchParams.set("token", token);
          confirm.searchParams.set("next", next);
          outbox.push({ email, url, confirmUrl: confirm.toString() });
        },
      }),
    ],
  });
}

/** Only same-origin, root-relative paths. Anything else becomes "/". */
export function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const u = new URL(value, "https://x.invalid");
    if (u.origin !== "https://x.invalid") return "/";
    // Check again after normalization: "/a/..//evil.example" passes the checks
    // above but normalizes to "//evil.example", a protocol-relative URL.
    if (u.pathname.startsWith("//")) return "/";
    return u.pathname + u.search;
  } catch {
    return "/";
  }
}

/** Our own CSRF gate, because auth.api.* calls skip Better Auth's request middlewares. */
function sameOrigin(req: Request, env: Env): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (origin) return origin === new URL(env.BASE_URL).origin;
  return true; // no browser metadata at all (old browser / curl): allow
}

const html = (body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8">${body}`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; form-action 'self'; base-uri 'none'",
    },
  });

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Test-only peek at the stubbed outbox.
    if (url.pathname === "/__spike/outbox") return Response.json(outbox);

    // Plain <form method="post" action="/login"> target.
    if (url.pathname === "/login" && req.method === "POST") {
      if (!sameOrigin(req, env)) return html("<p>Forbidden</p>", 403);
      const form = await req.formData();
      const email = String(form.get("email") ?? "");
      const next = safeNext(form.get("next"));
      const auth = makeAuth(env);
      try {
        await auth.api.signInMagicLink({
          body: { email, callbackURL: next, metadata: { next } },
          headers: req.headers,
        });
      } catch {
        return html("<p>Enter a valid email address.</p>", 400);
      }
      return new Response(null, { status: 303, headers: { location: "/login/sent" } });
    }

    // Prefetch-safe variant: GET only renders a button, POST consumes the token.
    if (url.pathname === "/auth/confirm" && req.method === "GET") {
      const token = url.searchParams.get("token") ?? "";
      const next = safeNext(url.searchParams.get("next"));
      return html(
        `<form method="post" action="/auth/confirm">` +
          `<input type="hidden" name="token" value="${esc(token)}">` +
          `<input type="hidden" name="next" value="${esc(next)}">` +
          `<button>Sign in</button></form>`,
      );
    }
    if (url.pathname === "/auth/confirm" && req.method === "POST") {
      if (!sameOrigin(req, env)) return html("<p>Forbidden</p>", 403);
      const form = await req.formData();
      const auth = makeAuth(env);
      return auth.api.magicLinkVerify({
        query: { token: String(form.get("token") ?? ""), callbackURL: safeNext(form.get("next")) },
        headers: req.headers,
        asResponse: true,
      });
    }

    if (url.pathname.startsWith("/api/auth/")) return makeAuth(env).handler(req);

    return new Response("not found", { status: 404 });
  },
};
