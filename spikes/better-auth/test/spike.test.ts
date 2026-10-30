import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { getMigrations } from "better-auth/db/migration";
import { beforeAll, describe, expect, it } from "vitest";
import { makeAuth, safeNext, type CapturedEmail, type Env } from "../src/worker";

const E = env as unknown as Env;
const BASE = "https://archive.test";
const worker = (exports as any).default as Fetcher;

const fetchW = (input: string, init: RequestInit = {}) =>
  worker.fetch(new URL(input, BASE).toString(), { redirect: "manual", ...init });

/** What a browser sends for a same-origin <form method="post">. */
async function postLogin(email: string, next: string) {
  return fetchW("/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: BASE,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "navigate",
    },
    body: new URLSearchParams({ email, next }).toString(),
  });
}

async function lastMail(email: string): Promise<CapturedEmail> {
  const all = (await (await fetchW("/__spike/outbox")).json()) as CapturedEmail[];
  const mine = all.filter((m) => m.email === email);
  expect(mine.length).toBeGreaterThan(0);
  return mine[mine.length - 1]!;
}

async function sessionsFor(email: string): Promise<number> {
  const row = await E.DB.prepare(
    `select count(*) as n from session s join user u on u.id = s.userId where u.email = ?`,
  )
    .bind(email)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

const setCookies = (res: Response) => res.headers.getSetCookie();

beforeAll(async () => {
  const { toBeCreated, toBeAdded, compileMigrations, runMigrations } = await getMigrations(
    makeAuth(E).options,
  );
  console.log("[tables] to create:", toBeCreated.map((t) => t.table).join(", "));
  console.log("[tables] to add:", JSON.stringify(toBeAdded));
  console.log("[tables] SQL:\n" + (await compileMigrations()));
  await runMigrations();
});

describe("Q2: no-JS flow", () => {
  it("form POST -> stubbed link -> GET sets cookie and redirects to next -> second GET fails", async () => {
    const email = "reader@example.test";
    const res = await postLogin(email, "/works/123");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login/sent");

    const mail = await lastMail(email);
    console.log("[q2] captured link:", mail.url);
    const link = new URL(mail.url);
    expect(link.origin + link.pathname).toBe(`${BASE}/api/auth/magic-link/verify`);
    expect(link.searchParams.get("callbackURL")).toBe("/works/123");

    const first = await fetchW(mail.url);
    console.log("[q2] first GET:", first.status, first.headers.get("location"));
    console.log("[q3] Set-Cookie:", JSON.stringify(setCookies(first), null, 2));
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe(`${BASE}/works/123`);
    const cookies = setCookies(first);
    expect(cookies.length).toBe(1);

    // Q3: cookie flags
    const c = cookies[0]!;
    expect(c).toMatch(/^__Secure-better-auth\.session_token=/);
    expect(c).toMatch(/;\s*HttpOnly/i);
    expect(c).toMatch(/;\s*Secure/i);
    expect(c).toMatch(/;\s*SameSite=Lax/i);
    expect(c).toMatch(/;\s*Path=\//i);
    expect(c).not.toMatch(/Domain=/i);
    expect(await sessionsFor(email)).toBe(1);

    // The cookie is a working session.
    const session = await fetchW("/api/auth/get-session", {
      headers: { cookie: c.split(";")[0]! },
    });
    const body = (await session.json()) as { user?: { email: string } } | null;
    expect(body?.user?.email).toBe(email);

    const second = await fetchW(mail.url);
    console.log("[q2] second GET:", second.status, second.headers.get("location"));
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect(setCookies(second)).toEqual([]);
    expect(await sessionsFor(email)).toBe(1);
  });

  it("next=https://evil.example: our route rewrites it to /", async () => {
    const email = "evil-next@example.test";
    await postLogin(email, "https://evil.example");
    const mail = await lastMail(email);
    console.log("[q2] link for next=https://evil.example:", mail.url);
    expect(new URL(mail.url).searchParams.get("callbackURL")).toBe("/");
    const res = await fetchW(mail.url);
    expect(res.headers.get("location")).toBe(`${BASE}/`);
  });

  it("Better Auth itself rejects foreign callbackURLs on verify (403), without consuming the token", async () => {
    // Bypass our sanitizer: call the API directly with a hostile callbackURL.
    const email = "direct-evil@example.test";
    await makeAuth(E).api.signInMagicLink({
      body: { email, callbackURL: "https://evil.example" },
      headers: new Headers(),
    });
    const mail = await lastMail(email);
    console.log("[q2] link minted with callbackURL=https://evil.example:", mail.url);
    const r1 = await fetchW(mail.url);
    console.log("[q2] GET ->", r1.status, await r1.text());
    expect(r1.status).toBe(403);

    // Tamper with a good link.
    const email2 = "tamper@example.test";
    await postLogin(email2, "/works/9");
    const good = (await lastMail(email2)).url;
    for (const evil of ["https://evil.example", "//evil.example", "/\\evil.example", "https://archive.test.evil.example/"]) {
      const bad = new URL(good);
      bad.searchParams.set("callbackURL", evil);
      const r = await fetchW(bad.toString());
      console.log(`[q2] tampered callbackURL=${evil} ->`, r.status);
      expect(r.status).toBe(403);
      expect(setCookies(r)).toEqual([]);
    }
    // The 403s happened in middleware, before the token was consumed.
    const ok = await fetchW(good);
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe(`${BASE}/works/9`);
  });

  it("server-side auth.api.magicLinkVerify skips originCheck: a foreign callbackURL IS followed", async () => {
    const email = "api-verify-evil@example.test";
    await postLogin(email, "/");
    const token = new URL((await lastMail(email)).url).searchParams.get("token")!;
    const res = (await makeAuth(E).api.magicLinkVerify({
      query: { token, callbackURL: "https://evil.example" },
      headers: new Headers(),
      asResponse: true,
    })) as Response;
    console.log("[q2] auth.api.magicLinkVerify(callbackURL=evil) ->", res.status, res.headers.get("location"));
    // originCheck returns early when ctx.request is undefined (origin-check.mjs:72),
    // so on this path our safeNext() is the only open-redirect guard.
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://evil.example/");
  });

  it("auth.handler does NOT accept a form-encoded body on /sign-in/magic-link", async () => {
    const form = await fetchW("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
      body: "email=handler%40example.test&callbackURL=%2Fworks%2F1",
    });
    console.log("[q2] handler form POST ->", form.status, await form.text());
    expect(form.status).toBe(415);

    const json = await fetchW("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email: "handler@example.test", callbackURL: "/works/1" }),
    });
    console.log("[q2] handler JSON POST ->", json.status);
    expect(json.status).toBe(200);
  });

  it("prefetch-safe variant: GET shows a button and consumes nothing; POST signs in once", async () => {
    const email = "confirm@example.test";
    await postLogin(email, "/works/77");
    const { confirmUrl } = await lastMail(email);
    const page = await fetchW(confirmUrl);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<form method="post" action="/auth/confirm">');
    expect(await sessionsFor(email)).toBe(0);

    const u = new URL(confirmUrl);
    const post = () =>
      fetchW("/auth/confirm", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: BASE,
          "sec-fetch-site": "same-origin",
        },
        body: new URLSearchParams({
          token: u.searchParams.get("token")!,
          next: u.searchParams.get("next")!,
        }).toString(),
      });
    const first = await post();
    console.log("[q2] confirm POST:", first.status, first.headers.get("location"), setCookies(first));
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe(`${BASE}/works/77`);
    expect(setCookies(first)[0]).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const second = await post();
    expect(second.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect(await sessionsFor(email)).toBe(1);
  });

  it("safeNext rejects paths that only become protocol-relative after normalization", () => {
    for (const evil of ["/a/..//evil.example", "/./..//evil.example", "/a/%2e%2e//evil.example", "//evil.example", "/\\evil.example"]) {
      expect(safeNext(evil), evil).toBe("/");
    }
    expect(safeNext("/works/12?x=1")).toBe("/works/12?x=1");
    expect(safeNext("/a/../works/12")).toBe("/works/12");
  });

  it("confirm POST with next=/a/..//evil.example stays on the site", async () => {
    const email = "dotdot@example.test";
    await postLogin(email, "/works/5");
    const u = new URL((await lastMail(email)).confirmUrl);
    const res = await fetchW("/auth/confirm", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: BASE,
        "sec-fetch-site": "same-origin",
      },
      // A tampered confirm form: next is replaced after the email was sent.
      body: new URLSearchParams({ token: u.searchParams.get("token")!, next: "/a/..//evil.example" }).toString(),
    });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).origin).toBe(BASE);
    expect(await sessionsFor(email)).toBe(1);
  });
});

describe("Q1: single use under concurrency", () => {
  it("two simultaneous verifies of one link create exactly one session (x25 rounds)", async () => {
    const tally: Record<string, number> = {};
    for (let i = 0; i < 25; i++) {
      const email = `race${i}@example.test`;
      await postLogin(email, "/works/123");
      const { url } = await lastMail(email);
      const [a, b] = await Promise.all([fetchW(url), fetchW(url)]);
      const outcome = [a, b]
        .map((r) => (setCookies(r).length ? "session" : r.headers.get("location")?.includes("INVALID_TOKEN") ? "invalid" : `other:${r.status}`))
        .sort()
        .join("+");
      tally[outcome] = (tally[outcome] ?? 0) + 1;
      expect(await sessionsFor(email)).toBe(1);
    }
    console.log("[q1] outcomes over 25 rounds:", JSON.stringify(tally));
    expect(tally["invalid+session"]).toBe(25);
  });

  it("ten simultaneous verifies of one link create exactly one session", async () => {
    const email = "race-ten@example.test";
    await postLogin(email, "/works/1");
    const { url } = await lastMail(email);
    const results = await Promise.all(Array.from({ length: 10 }, () => fetchW(url)));
    const withCookie = results.filter((r) => setCookies(r).length > 0).length;
    console.log("[q1] 10-way race: responses with Set-Cookie =", withCookie, "sessions =", await sessionsFor(email));
    expect(withCookie).toBe(1);
    expect(await sessionsFor(email)).toBe(1);
  });

  it("direct consumeVerificationValue race on one auth instance and on separate instances", async () => {
    // Separate instances = separate in-process locks, so only the DB DELETE ... RETURNING gates.
    for (const shared of [true, false]) {
      const email = `consume-${shared}@example.test`;
      await postLogin(email, "/");
      const token = new URL((await lastMail(email)).url).searchParams.get("token")!;
      const one = makeAuth(E);
      const ctxs = await Promise.all(
        Array.from({ length: 5 }, async () => (shared ? one : makeAuth(E)).$context),
      );
      // Same identifier the plugin uses: `magic-link:${hashedToken}` (storeToken: "hashed").
      const { defaultKeyHasher } = await import(
        "../node_modules/better-auth/dist/plugins/magic-link/utils.mjs" as string
      );
      const id = `magic-link:${await defaultKeyHasher(token)}`;
      const got = await Promise.all(ctxs.map((c) => c.internalAdapter.consumeVerificationValue(id)));
      const winners = got.filter(Boolean).length;
      console.log(`[q1] consumeVerificationValue x5, shared instance=${shared}: winners=${winners}`);
      expect(winners).toBe(1);
    }
  });

  it("control: a naive find-then-delete on the same D1 DOES double-spend, so the race is real", async () => {
    const id = "naive-control";
    const seed = makeAuth(E);
    const ctx0 = await seed.$context;
    await ctx0.internalAdapter.createVerificationValue({
      identifier: id,
      value: "x",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const naive = async () => {
      const ctx = await makeAuth(E).$context;
      const found = await ctx.adapter.findOne({ model: "verification", where: [{ field: "identifier", value: id }] });
      if (!found) return null;
      await ctx.adapter.deleteMany({ model: "verification", where: [{ field: "identifier", value: id }] });
      return found; // affected-row count ignored: this is the bug pattern
    };
    const got = await Promise.all(Array.from({ length: 5 }, naive));
    const winners = got.filter(Boolean).length;
    console.log("[q1] control naive find-then-delete x5: winners =", winners);
    expect(winners).toBeGreaterThan(1);
  });
});
