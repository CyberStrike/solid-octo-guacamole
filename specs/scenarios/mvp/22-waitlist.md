# Scenario: Coming-soon page and launch wait list

Relates to: docs/ARCHITECTURE.md § Decisions so far (Wait list), § Wait list, § Auth (Email), § Surge controls, § Data model; docs/FRONTEND-DISCOVERY.md § Page inventory (Coming soon, Confirm wait list)

## Setup
- The web Worker serves `rarepair.fans` with its `PRELAUNCH` setting on, unless a case says it is off
- A `waitlist` table exists in Postgres (ARCHITECTURE, *Data model*)
- Turnstile is configured on the wait list form; a test Turnstile token that passes and one that fails are available
- The Workers rate-limiting binding is configured per IP and per email for `POST /waitlist`
- The web Worker puts wait list confirmation emails on the `email` queue; launch emails go on the `email-bulk` queue; the mailer Worker consumes both, with a stub Resend sender capturing sent messages
- Emails in these cases are test addresses only

## Cases

### Coming-soon page shows the wait list form
- GIVEN `PRELAUNCH` is on and a visitor with JavaScript on
- WHEN they open `/`
- THEN the page says rarepair is coming soon and shows an email address form with Turnstile alongside
- AND it says the address gets one email when the archive opens, and nothing else

### Coming-soon page without JavaScript explains the form needs it
- GIVEN `PRELAUNCH` is on and a visitor with JavaScript off
- WHEN they open `/`
- THEN the rest of the page renders, and a `<noscript>` message says joining the wait list needs JavaScript
- AND no wait list request can be submitted from the page

### Coming-soon page allows the Turnstile frame and nothing more
- GIVEN `PRELAUNCH` is on
- WHEN `/` is requested
- THEN its CSP header is the strict policy plus exactly `frame-src https://challenges.cloudflare.com`, as on the other Turnstile pages

### Other app pages are closed before launch
- GIVEN `PRELAUNCH` is on
- WHEN a visitor opens any app page other than `/`, the `/waitlist` pages, `/terms`, `/privacy`, `/login` (with `/login/confirm`) or `/admin`
- THEN they are redirected to `/` with a 302
- AND `content.rarepair.fans` is unaffected

### Joining queues one confirmation email
- GIVEN an address that is not on the wait list and a passing Turnstile token
- WHEN the visitor submits the form, a plain `application/x-www-form-urlencoded` POST to `/waitlist`
- THEN a `waitlist` row is created for the address, trimmed and lowercased, with `confirmed_at` empty
- AND one email linking to `https://rarepair.fans/waitlist/confirm` with a token is put on the `email` queue
- AND only a hash of the token is stored, never the token itself, and it is valid for 7 days
- AND the response is a "Check your email to confirm" page

### Joining twice tells nobody anything
- GIVEN an address that is already on the wait list, confirmed or not
- WHEN it is submitted again with a passing Turnstile token
- THEN the response is the same "Check your email to confirm" page as for a new address, with the same status code
- AND a confirmed address gets no email
- AND an unconfirmed address gets a fresh confirmation email only if its last one was sent more than an hour ago; the new token replaces the old one

### Join request without Turnstile is refused
- GIVEN a visitor
- WHEN they submit `POST /waitlist` with a missing or failing Turnstile token
- THEN no row is written and no email is queued
- AND the response is 400 and shows the form again with an error

### Join request without a valid address is refused
- GIVEN a visitor with a passing Turnstile token
- WHEN they submit `POST /waitlist` with no address, or one longer than 254 characters, or one without an `@`
- THEN no row is written and no email is queued
- AND the response is 400 and shows the form again with an error

### Cross-site join request is refused
- GIVEN a `POST /waitlist` whose `Origin` is present and is not exactly `https://rarepair.fans`, or whose `Sec-Fetch-Site` is present and is not `same-origin`
- WHEN the web Worker receives it
- THEN the response is 403
- AND no row is written and no email is queued

### Join requests are rate-limited per IP
- GIVEN one IP address that has reached the wait list rate limit within the current window
- WHEN it submits another `POST /waitlist`, even for a different address
- THEN the response is 429 with a `Retry-After` header, no row is written and no email is queued
- AND a plain page says when to try again

### Join requests are rate-limited per email
- GIVEN one address that has reached the wait list rate limit within the current window
- WHEN another `POST /waitlist` is submitted for that address from a different IP
- THEN the response is 429 with a `Retry-After` header and no email is queued
- AND a plain page says when to try again

### Opening the confirmation link uses nothing up
- GIVEN an unconfirmed address with a token issued less than 7 days ago
- WHEN the link `GET /waitlist/confirm?token=<token>` is opened, as a mail scanner prefetching it would
- THEN the page shows a "Confirm" button in a POST form
- AND `confirmed_at` is still empty

### Confirming puts the address on the list
- GIVEN an unconfirmed address with a token issued less than 7 days ago
- WHEN the visitor presses "Confirm", submitting `POST /waitlist/confirm` with the token, with or without JavaScript
- THEN `confirmed_at` is set and the token hash is cleared, so the link can't be used again
- AND the page says "You're on the list" and that one email will follow when rarepair opens

### Used, expired or unknown confirmation links are refused plainly
- GIVEN a confirmation token that was already used, was issued more than 7 days ago, or was never issued
- WHEN `POST /waitlist/confirm` is submitted with it
- THEN nothing changes in `waitlist`
- AND the page says the link is used or expired, with a link back to `/` to join again

### The wait list keeps only what the launch email needs
- GIVEN any join, resend or confirm request
- WHEN it is handled
- THEN the `waitlist` row holds only the address, the token hashes and their times, `confirmed_at` and `notified_at`, with no IP address, user agent or referrer
- AND no log line, in the web Worker or the mailer, contains the address or a link

### The launch send emails each confirmed address once
- GIVEN confirmed and unconfirmed addresses on the wait list, and a signed-in account with the `admin` role
- WHEN that account starts the launch send from the admin area, with `PRELAUNCH` on or off
- THEN each confirmed address with `notified_at` empty gets `notified_at` set and a launch email put on the `email-bulk` queue, in batches
- AND a batch whose enqueue fails has `notified_at` cleared again, so the next run picks it up
- AND unconfirmed addresses get no email
- AND starting the launch send again, at the same time or later, puts no address on the queue a second time
- AND a moderator without the `admin` role, or anyone signed out, gets 404

### The launch send is spread out
- GIVEN tens of thousands of confirmed addresses
- WHEN the launch send runs
- THEN the mailer sends launch emails through Resend's batch API at no more than the configured rate, so they arrive over hours, not at once

### Sign-in emails are not delayed by the launch send
- GIVEN the launch send has queued thousands of launch emails
- WHEN a visitor requests a sign-in link
- THEN its email is sent from the `email` queue without waiting behind the launch emails on `email-bulk`
- AND the launch send's rate leaves room under Resend's per-second API limit for sign-in emails

### The launch email has a one-click unsubscribe
- GIVEN a launch email
- WHEN it is built
- THEN it carries `List-Unsubscribe` with an `https://rarepair.fans/waitlist/unsubscribe` link holding a token, and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
- AND a `POST` to that link deletes the address's row and answers 200, with no sign-in and no page to click through
- AND the link keeps working with `PRELAUNCH` off, and a `POST` with a token whose row is already gone (unsubscribed or purged) also answers 200

### The wait list is deleted after the launch send
- GIVEN the launch send has finished
- WHEN an account with the `admin` role runs the wait list purge from the admin area
- THEN every `waitlist` row is deleted, confirmed or not
- AND the purge refuses to run while any confirmed address still has `notified_at` empty, unless it is explicitly forced

### After launch the archive takes over
- GIVEN `PRELAUNCH` is off
- WHEN a visitor opens `/`
- THEN they see the home page, with no wait list form
- AND `POST /waitlist` answers 404, and `/waitlist/confirm` shows a plain page saying the archive is open, with a link to `/`

### Privacy notice covers the wait list
- GIVEN `PRELAUNCH` is on
- WHEN a visitor opens `/privacy`
- THEN it says the wait list keeps only the address, sends one confirmation email and one launch email, and is deleted after launch
