# Scenario: Magic-link sign-in and sessions

Relates to: docs/ARCHITECTURE.md § Auth (magic link); docs/FRONTEND-DISCOVERY.md § Key journeys (2. Sign in), § Page inventory

## Setup
- The web Worker serves `app.<domain>` with `/login` and `/login/verify`
- Turnstile is configured on the sign-in form; a test Turnstile token that passes and one that fails are available
- KV holds login tokens (as hashes) and sessions; the Workers rate-limiting binding is configured per IP and per email for login
- The outbound email queue and a stub sender capture sent messages; a second (failover) provider stub is wired in
- No passwords are stored anywhere in the users table or KV

## Cases

### Sign-in page shows an email form
- GIVEN a signed-out visitor
- WHEN they open `/login`
- THEN the page shows an email address form with Turnstile alongside
- AND the form works with JavaScript off

### Requesting a magic link sends a single-use token
- GIVEN a signed-out visitor with a valid email address and a passing Turnstile token
- WHEN they submit `POST /login`
- THEN an email containing a sign-in link with a token is put on the email queue
- AND only a hash of the token is stored in KV, never the token itself
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
- AND the sign-in page shows an error state

### Login requests are rate-limited per IP
- GIVEN one IP address that has reached the login rate limit within the current window
- WHEN it submits another `POST /login`, even for a different email address
- THEN the request is throttled and no email is queued

### Login requests are rate-limited per email
- GIVEN one email address that has reached the login rate limit within the current window
- WHEN another `POST /login` is submitted for that email from a different IP
- THEN the request is throttled and no email is queued

### Valid link signs the user in
- GIVEN an unused token issued less than 15 minutes ago
- WHEN the user opens `GET /login/verify?t=<token>`
- THEN the token is used up
- AND a session is stored in KV
- AND a session cookie is set with `HttpOnly`, `Secure` and `SameSite=Lax`
- AND the cookie is scoped to `app.<domain>` only, not to the parent domain or `content.<domain>`

### Token cannot be used twice
- GIVEN a token that has already been used to sign in
- WHEN `GET /login/verify?t=<token>` is opened again
- THEN no new session is created and no session cookie is set
- AND the sign-in page shows an error state

### Concurrent use of the same token creates at most one session
- GIVEN an unused, unexpired token
- WHEN two `GET /login/verify?t=<token>` requests arrive at the same time
- THEN at most one of them creates a session

### Expired token is refused
- GIVEN a token issued more than 15 minutes ago and never used
- WHEN `GET /login/verify?t=<token>` is opened
- THEN no session is created
- AND the sign-in page shows an error state

### Unknown token is refused
- GIVEN a token value that was never issued
- WHEN `GET /login/verify?t=<token>` is opened
- THEN no session is created
- AND the sign-in page shows an error state

### Sign-in returns the user to where they started
- GIVEN a signed-out visitor who started signing in from a work page
- WHEN they complete sign-in through the emailed link
- THEN they are redirected back to that work page using a stored `next` value

### Sign-in never acts as an open redirect
- GIVEN a sign-in attempt where the `next` target is an external URL
- WHEN the user completes sign-in through the emailed link
- THEN they are not redirected to the external URL

### Email sending fails over to the second provider
- GIVEN the primary sender (Cloudflare Email Sending) is refusing messages because its quota is reached
- WHEN a sign-in email is taken off the email queue
- THEN it is sent through the second provider instead

### Reading needs no account
- GIVEN a signed-out visitor with no session cookie
- WHEN they open the home page, a work page and a chapter of a live work
- THEN every page renders without asking them to sign in

### Uploading needs an account
- GIVEN a signed-out visitor
- WHEN they open `/upload` or call `POST /uploads`
- THEN they are not allowed to upload without signing in
