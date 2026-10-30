# Spike: Better Auth magic link on Workers

A throwaway spike that checked whether Better Auth's magic-link plugin fits
ARCHITECTURE § Auth: plain no-JS forms, a strict CSP, single-use links. It is
**reference code, not production code**. Nothing here is deployed, and it is
not an npm workspace, so the root `npm test` doesn't run it.

```bash
cd spikes/better-auth
npm ci
npm test
```

The tests run in workerd with a local D1 database. The `sendMagicLink`
callback is stubbed, so no email is sent and no external service is called.
`AUTH_SECRET` in `vitest.config.ts` is a test-only value.

## What it showed (better-auth 1.7.14)

1. **Links are single-use under concurrency.**
   - Verify consumes the token with one `DELETE … RETURNING`
     (`consumeVerificationValue`), and a session is created only for the
     request that gets the row back.
   - In tests, 25 rounds of two concurrent verifies and one round of ten each
     produced exactly one session. A naive find-then-delete control let 5 of 5
     through, which shows the harness really interleaves requests.
   - Postgres across isolates was not run here; the source reading covers it.
   - This holds only while tokens live in the database: KV `secondaryStorage`
     has no atomic get-and-delete.
2. **The no-JS flow works through our own routes.**
   - Better Auth's endpoint accepts only JSON, so our form route calls
     `auth.api.signInMagicLink` on the server.
   - Server-side `auth.api` calls skip Better Auth's CSRF, open-redirect and
     rate-limit middleware, so the routes do those themselves: `sameOrigin()`
     and `safeNext()` here.
3. **The cookie flags are right by default:**
   `__Secure-better-auth.session_token; HttpOnly; Secure; SameSite=Lax; Path=/`,
   with no `Domain`.

Also checked: a confirm page that survives mail-scanner prefetch (GET shows a
button, POST consumes the token), `nodejs_compat` (needed for
`AsyncLocalStorage`), and an auth instance built per request.

## Where it differs from ARCHITECTURE (fix these when building `apps/web`)

- The confirm route is `/auth/confirm` here; ARCHITECTURE uses `/login/confirm`.
- A failed confirm redirects to `next?error=INVALID_TOKEN`. ARCHITECTURE sends
  the user back to `/login`; pass `errorCallbackURL: "/login"`.
- Rate limiting is off (`rateLimit: { enabled: false }`) so the tests stay
  deterministic. Production uses database storage, plus our own limits on
  `POST /login`.
- Any `signInMagicLink` error is reported as "Enter a valid email address".
  Production should tell a bad address apart from a server failure.
- `/__spike/outbox` and the module-level `outbox` array exist only for the
  tests. Never ship them.
- The local database is D1 (SQLite). Production uses Neon through Hyperdrive
  with `pg` and Kysely's `PostgresDialect`. Pin
  `@better-auth/kysely-adapter` to the better-auth version.
