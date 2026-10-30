# Scenario: Magic-link sign-in and sessions

Relates to: docs/ARCHITECTURE.md § Auth (magic link: Better Auth + Resend), § Data model, § Surge controls; docs/FRONTEND-DISCOVERY.md § Decisions so far (JavaScript), § Key journeys (2. Sign in), § Page inventory (Sign in, Accept terms, Too many requests), § Where the frontend changes the architecture (1. Forms with Turnstile need JS)

## Setup
- The web Worker serves `rarepair.fans` with `/login` and `/login/confirm`, and builds a Better Auth instance (magic-link plugin) per request from its bindings, with `baseURL` `https://rarepair.fans` and only that origin in `trustedOrigins`
- Better Auth's `user`, `session`, `account` and `verification` tables exist in Postgres; magic-link tokens are stored hashed in `verification`; `user` has a `terms_accepted_at` field
- Turnstile is configured on the sign-in form; a test Turnstile token that passes and one that fails are available
- The Workers rate-limiting binding is configured per IP and per email for `POST /login`
- The web Worker puts sign-in emails on the `email` queue; the mailer Worker (`apps/mailer`) consumes it, with a stub Resend sender capturing sent messages and a failover provider stub (Postmark or SES) wired in
- No passwords are stored anywhere
- `disableSignUp` is not set, so Better Auth creates an account for an unknown email when its link is confirmed

## Cases

### Sign-in page shows an email form
- GIVEN a signed-out visitor with JavaScript on
- WHEN they open `/login`
- THEN the page shows an email address form with Turnstile alongside

### Sign-in page without JavaScript explains it is needed
- GIVEN a signed-out visitor with JavaScript off
- WHEN they open `/login`
- THEN the page shows a `<noscript>` message saying signing in needs JavaScript
- AND no sign-in request can be submitted from the page

### Requesting a magic link queues an email with a single-use token
- GIVEN a signed-out visitor with a valid email address and a passing Turnstile token
- WHEN they submit the `/login` form, a plain `application/x-www-form-urlencoded` POST
- THEN an email linking to `https://rarepair.fans/login/confirm` with a token is put on the email queue, whatever host the request came in on
- AND only a hash of the token is stored in the `verification` table, never the token itself
- AND the token is valid for 15 minutes

### Check-your-email page sets expectations
- GIVEN a visitor who has just submitted a valid sign-in request
- WHEN the response page renders
- THEN a "Check your email" page says the link lasts 15 minutes
- AND it says the link can take a minute to arrive during busy periods

### Login request without Turnstile is refused
- GIVEN a signed-out visitor
- WHEN they submit `POST /login` with a missing or failing Turnstile token
- THEN no token is created and no email is queued
- AND the response is 400 and shows the sign-in form again with an error

### Cross-site login request is refused
- GIVEN a `POST /login` whose `Origin` is present and is not exactly `https://rarepair.fans` (another site, or another `rarepair.fans` host such as `content.rarepair.fans`), or whose `Sec-Fetch-Site` is present and is not `same-origin`
- WHEN the web Worker receives it
- THEN the response is 403
- AND no token is created and no email is queued

### Login requests are rate-limited per IP
- GIVEN one IP address that has reached the login rate limit within the current window
- WHEN it submits another `POST /login`, even for a different email address
- THEN the response is 429 with a `Retry-After` header and no email is queued
- AND a plain page says when to try again

### Login requests are rate-limited per email
- GIVEN one email address that has reached the login rate limit within the current window
- WHEN another `POST /login` is submitted for that email from a different IP
- THEN the response is 429 with a `Retry-After` header and no email is queued
- AND a plain page says when to try again

### Opening the emailed link uses nothing up
- GIVEN an unused token issued less than 15 minutes ago
- WHEN the link `GET /login/confirm?token=<token>` is opened, as a mail scanner prefetching it would
- THEN the page shows a "Sign in" button in a POST form
- AND the token is still unused and no session is created

### Confirming signs the user in
- GIVEN an unused token issued less than 15 minutes ago
- WHEN the user presses "Sign in", submitting `POST /login/confirm` with the token
- THEN the token's `verification` row is deleted
- AND a session row is created in Postgres
- AND the cookie `__Secure-better-auth.session_token` is set with `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/`
- AND the cookie has no `Domain` attribute, so it covers `rarepair.fans` only and never `content.rarepair.fans`

### Confirming works without JavaScript
- GIVEN an unused token and a browser with JavaScript off
- WHEN the user opens the emailed link and presses "Sign in"
- THEN they are signed in and redirected, with no script involved

### Token cannot be used twice
- GIVEN a token that has already been used to sign in
- WHEN `POST /login/confirm` is submitted with it again
- THEN no new session is created and no session cookie is set
- AND the response redirects to `/login`, which shows a plain message that the link is used or expired

### Concurrent use of the same token creates at most one session
- GIVEN an unused, unexpired token
- WHEN two `POST /login/confirm` requests with that token arrive at the same time, through different Worker isolates
- THEN exactly one of them creates a session, because the token is consumed by a single `DELETE … RETURNING` in Postgres

### Expired token is refused
- GIVEN a token issued more than 15 minutes ago and never used
- WHEN `POST /login/confirm` is submitted with it
- THEN no session is created
- AND the response redirects to `/login`, which shows a plain message that the link is used or expired

### Unknown token is refused
- GIVEN a token value that was never issued
- WHEN `POST /login/confirm` is submitted with it
- THEN no session is created
- AND the response redirects to `/login`, which shows a plain message that the link is used or expired

### Sign-in returns the user to where they started
- GIVEN a signed-out visitor who started signing in from a work page
- WHEN they complete sign-in through the emailed link
- THEN they are redirected back to that work page, using the same-site `next` path our `/login` route stored

### Sign-in never acts as an open redirect
- GIVEN a sign-in request whose `next` is an external or protocol-relative URL (`https://evil.example`, `//evil.example`, `/\evil.example`)
- WHEN the user completes sign-in through the emailed link
- THEN they are redirected within `rarepair.fans` (the home page), never to the external URL

### Sign-in emails go through Resend in batches
- GIVEN several sign-in emails waiting on the email queue
- WHEN the mailer Worker takes them off the queue
- THEN it sends them through Resend's batch API rather than one API call per email

### Email sending fails over to the second provider
- GIVEN Resend is refusing messages (rate limit, quota or outage)
- WHEN a sign-in email is taken off the email queue
- THEN it is sent through the failover provider instead

### New email creates an account on confirm
- GIVEN an email address with no account, and an unused token issued to it less than 15 minutes ago
- WHEN the user presses "Sign in", submitting `POST /login/confirm` with the token
- THEN a `user` row is created for that email, with `terms_accepted_at` empty
- AND a session is created for the new account

### New account must accept the terms before continuing
- GIVEN a new account, signed in with `terms_accepted_at` empty, that started signing in from a work page
- WHEN it opens any page other than `/welcome/terms`, `/terms`, `/privacy` or sign-out
- THEN it is redirected to `/welcome/terms`
- AND once it accepts there, `terms_accepted_at` is set and it continues to the work page it started from

### Returning user skips the terms page
- GIVEN an existing account whose `terms_accepted_at` is set
- WHEN it signs in again through an emailed link
- THEN it goes straight to its `next` page and is never shown `/welcome/terms`

### Reading needs no account
- GIVEN a signed-out visitor with no session cookie
- WHEN they open the home page, a work page and a chapter of a live work
- THEN every page renders without asking them to sign in

### Uploading needs an account
- GIVEN a signed-out visitor
- WHEN they open `/upload`, or their browser's script calls `POST /uploads`
- THEN opening `/upload` redirects them to sign in, carrying `next=/upload`
- AND `POST /uploads` answers 401, since a script can't follow a sign-in redirect
- AND no `uploads` row is inserted and no presigned URL is returned
