# Scenario: Remove-my-work and opt-out requests

Relates to: docs/ARCHITECTURE.md § Decisions so far (Author identity), § Data model (requests, optouts), § Author requests & takedowns; docs/FRONTEND-DISCOVERY.md § Key journeys (4. Remove a work or opt out), § Page inventory (Remove my work / opt out, Hidden work), § Where the frontend changes the architecture (1. Forms with Turnstile need JS)

## Setup
- Live work W at `/works/:id` with AO3 URL `archiveofourown.org/works/12345`, by pseud P
- Live works W2 and W3 also by pseud P, and work X by another pseud
- Turnstile is configured on `/remove`; rate limits apply per email and per IP
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

### Confirmation page for a work
- GIVEN a remove request just submitted for W
- WHEN the confirmation page renders
- THEN it says the work is already hidden and that a moderator will review the request and email them

### Hidden work shows a temporary-hide page
- GIVEN W hidden after a removal request
- WHEN anyone opens W
- THEN the response is 451 with "Temporarily hidden after a removal request", not a 404

### Opt-out by pseud hides every existing work
- GIVEN works W, W2 and W3 by pseud P and work X by another pseud
- WHEN a visitor submits `/remove` with pseud P instead of a work, a contact email, a statement and a passing Turnstile token
- THEN an `opt_out` request and an active `optouts` row for P's `pseud_norm` are stored
- AND W, W2 and W3 are hidden at once
- AND X is unaffected

### Confirmation page for an opt-out
- GIVEN an opt-out just submitted for pseud P
- WHEN the confirmation page renders
- THEN it says every work by the pseud is already hidden and a moderator will review and email them

### Opt-out blocks future uploads
- GIVEN an active opt-out for pseud P
- WHEN a new AO3 epub by P is uploaded
- THEN it is rejected at ingest with `opted_out`

### Opt-out matches the normalized pseud
- GIVEN an active opt-out for pseud P
- AND an upload whose byline pseud has the same `pseud_norm` as P (normalization rule to be decided)
- WHEN the upload is ingested
- THEN it is rejected with `opted_out`

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
- THEN no request is stored and nothing is hidden

### Missing fields are refused
- GIVEN the `/remove` form
- WHEN it is submitted without a contact email or without a work or pseud
- THEN no request is stored and nothing is hidden

### Requests are rate-limited per email
- GIVEN one contact email that has reached the request rate limit
- WHEN another request is submitted with that email from a different IP
- THEN it is refused and nothing more is hidden

### Requests are rate-limited per IP
- GIVEN one IP address that has reached the request rate limit
- WHEN another request is submitted from that IP with a different email
- THEN it is refused and nothing more is hidden

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
