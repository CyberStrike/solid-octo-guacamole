# Scenario: Remove-my-work and opt-out requests

Relates to: docs/ARCHITECTURE.md § Decisions so far (Author identity), § Data model (requests, optouts, requester_blocks), § Dedupe (Pseuds), § Author requests & takedowns, § Surge controls (Status codes); docs/FRONTEND-DISCOVERY.md § Key journeys (4. Remove a work or opt out), § Page inventory (Remove my work / opt out, Hidden work), § Where the frontend changes the architecture (1. Forms with Turnstile need JS)

## Setup
- Live work W at `/works/:id` with AO3 URL `archiveofourown.org/works/12345`, by pseud P, written `Moon Child`
- Live works W2 and W3 also by pseud P, and work X by another pseud
- No work in the archive has AO3 URL `archiveofourown.org/works/99999`
- Turnstile is configured on `/remove`; rate limits apply per email and per IP
- `pseud_norm` is the pseud in Unicode NFKC, case-folded, with leading and trailing whitespace trimmed and inner runs of whitespace collapsed to one space; punctuation is kept
- A requester B blocked by a moderator, by contact email and IP hash
- The visitor is signed out

## Cases

### Form needs no sign-in
- GIVEN a signed-out visitor with JavaScript on
- WHEN they open `/remove`
- THEN the request form is shown without asking them to sign in

### Removal form without JavaScript explains it is needed and gives the moderators' contact address
- GIVEN a signed-out visitor with JavaScript off
- WHEN they open `/remove`
- THEN the page shows a `<noscript>` message saying the request form needs JavaScript
- AND the message gives the moderators' contact address
- AND no request can be submitted from the page

### Footer link reaches the form
- GIVEN any page
- WHEN a visitor follows "Remove my work" in the footer
- THEN they reach `/remove`

### Work is prefilled from the work page
- GIVEN a visitor on W's work page
- WHEN they follow "Ask for this to be removed"
- THEN `/remove?work=:id` shows the form with W prefilled

### Form says there is no proof of identity
- GIVEN the `/remove` form
- WHEN it renders
- THEN it says plainly that no proof of identity is asked for, because there is nothing to check against while AO3 is down

### Remove request by the work's URL here hides it at once
- GIVEN live work W
- WHEN a visitor submits `/remove` with W's URL on this site, a contact email, a short statement and a passing Turnstile token
- THEN a `remove_work` request is stored
- AND W is hidden at once
- AND the request awaits moderator review

### Remove request by AO3 URL hides it at once
- GIVEN live work W
- WHEN a visitor submits `/remove` with `archiveofourown.org/works/12345`, a contact email, a statement and a passing Turnstile token
- THEN W is hidden at once

### Remove request for an AO3 work not in the archive stores nothing
- GIVEN no work in the archive with AO3 URL `archiveofourown.org/works/99999`
- WHEN a visitor submits `/remove` with that URL, a contact email, a statement and a passing Turnstile token
- THEN no request is stored and nothing is hidden
- AND the confirmation page says the work isn't in the archive and suggests opting out the pseud instead

### Confirmation page for a work
- GIVEN a remove request for W just submitted by a requester who isn't blocked
- WHEN the confirmation page renders
- THEN it says "Your request was received; a moderator will review it and email you."
- AND it also says the work is hidden now

### Hidden work shows a temporary-hide page
- GIVEN W hidden after a removal request
- WHEN anyone opens W's work page, any of its chapter URLs or `/works/:id/full`
- THEN the response is 451 with "Temporarily hidden after a removal request", not a 404
- AND W is left out of search, listings and the home page

### Opt-out hides use the removal-request wording
- GIVEN W2 hidden by an opt-out for pseud P
- WHEN anyone opens W2
- THEN the response is 451 with "Temporarily hidden after a removal request", because opt-outs come through `/remove`

### Opt-out by pseud hides every existing work
- GIVEN works W, W2 and W3 by pseud P and work X by another pseud
- WHEN a visitor submits `/remove` with pseud P instead of a work, a contact email, a statement and a passing Turnstile token
- THEN an `opt_out` request and an active `optouts` row for P's `pseud_norm` are stored
- AND W, W2 and W3 are hidden at once
- AND X is unaffected

### Confirmation page for an opt-out
- GIVEN an opt-out for pseud P just submitted by a requester who isn't blocked
- WHEN the confirmation page renders
- THEN it says "Your request was received; a moderator will review it and email you."
- AND it also says every work by the pseud is hidden now

### Opt-out blocks future uploads
- GIVEN an active opt-out for pseud P
- WHEN a new AO3 epub by P is uploaded
- THEN it is rejected at ingest with `opted_out`

### Opt-out matches the normalized pseud
- GIVEN an active opt-out for pseud P
- AND an upload whose byline pseud has the same `pseud_norm` as P under the NFKC, case-fold, trim and collapse-whitespace rule
- WHEN the upload is ingested
- THEN it is rejected with `opted_out`

### Opt-out matches a pseud that differs only in case
- GIVEN an active opt-out requested for `Moon Child`
- WHEN an upload whose byline pseud is `moon CHILD` is ingested
- THEN it is rejected with `opted_out`

### Opt-out matches a pseud with extra spaces
- GIVEN an active opt-out requested for `Moon Child`
- WHEN an upload whose byline pseud is `  Moon   Child ` is ingested
- THEN it is rejected with `opted_out`

### Opt-out does not match different punctuation
- GIVEN an active opt-out requested for `Moon Child`
- WHEN an upload whose byline pseud is `Moon_Child` is ingested
- THEN it is not rejected with `opted_out`, because punctuation is kept in `pseud_norm`

### Moderator confirms an opt-out
- GIVEN a pending opt-out request for P
- WHEN a moderator approves it
- THEN the opt-out stays active and P's works stay hidden

### Mistaken opt-out can be reversed
- GIVEN an active opt-out for P that was made by mistake
- WHEN a moderator reverses it
- THEN the opt-out is no longer active
- AND new uploads by P are no longer rejected with `opted_out`

### Missing Turnstile is refused
- GIVEN the `/remove` form
- WHEN it is submitted with a missing or failing Turnstile token
- THEN the response is 400 and shows the form again with an error
- AND no request is stored and nothing is hidden

### Missing fields are refused
- GIVEN the `/remove` form
- WHEN it is submitted without a contact email or without a work or pseud
- THEN the response is 400 and shows the form again with the missing fields marked as errors
- AND no request is stored and nothing is hidden

### Requests are rate-limited per email
- GIVEN one contact email that has reached the request rate limit
- WHEN another request is submitted with that email from a different IP
- THEN the response is 429 with a `Retry-After` header and a plain page saying when to try again
- AND no request is stored and nothing more is hidden

### Requests are rate-limited per IP
- GIVEN one IP address that has reached the request rate limit
- WHEN another request is submitted from that IP with a different email
- THEN the response is 429 with a `Retry-After` header and a plain page saying when to try again
- AND no request is stored and nothing more is hidden

### Blocked requester's requests only queue
- GIVEN requester B, blocked by contact email and IP hash
- WHEN a request to remove live work X arrives from B's email, or from B's IP with another email, with a passing Turnstile token
- THEN the request is stored and appears in the moderators' requests queue
- AND X stays live

### Blocked requester's opt-out hides nothing
- GIVEN requester B, blocked by contact email and IP hash
- WHEN B submits an opt-out for pseud P
- THEN the request is stored and queued for a moderator
- AND W, W2 and W3 stay live
- AND no active `optouts` row is created unless a moderator approves the request

### Blocked requester sees the same confirmation
- GIVEN requester B, blocked by contact email and IP hash
- WHEN B submits a request to remove live work X, or an opt-out for pseud P, with a passing Turnstile token
- THEN the confirmation page says "Your request was received; a moderator will review it and email you."
- AND it does not say that anything is hidden now
- AND nothing on the page reveals that B is blocked

### Requests record a hashed IP
- GIVEN any submitted request
- WHEN it is stored
- THEN the row has an `ip_hash`, not the raw IP

### Approved removal really removes
- GIVEN work W hidden after a removal request
- WHEN a moderator approves the request and the work is set to `removed`
- THEN `works/<ao3_work_id>/` and the raw upload are deleted from R2
- AND the work's pages, cached fragments, images and download URLs are purged from the cache
- AND W's page returns 410 "This work has been removed"

### Authors update works the same way as anyone
- GIVEN an author who wants to update their work
- WHEN they look for a way to do it
- THEN there is no claim, author account or "my works" page, only a normal upload under the versioning rules
