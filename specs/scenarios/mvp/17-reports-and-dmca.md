# Scenario: Reports and DMCA takedown notices

Relates to: docs/ARCHITECTURE.md § Data model (reports.reporter_id, takedowns), § Author requests & takedowns (Reports, DMCA, Removal really removes); docs/FRONTEND-DISCOVERY.md § Key journeys (5. Report a work), § Page inventory (Report, DMCA notice)

## Setup
- A live work W with no open reports
- The auto-hide threshold N is configured
- `/works/:id/report` and `/dmca` are served by the web Worker
- A signed-in reader U and a signed-out reader

## Cases

### Every work has a report button
- GIVEN live work W
- WHEN its work page renders
- THEN it has a "Report" link to `/works/:id/report`

### Signed-in reader can report a work
- GIVEN signed-in reader U on W's work page
- WHEN U follows "Report"
- THEN W's report form is shown without asking U to sign in again

### Signed-out reader is sent to sign in before reporting
- GIVEN a signed-out reader on W's work page
- WHEN they follow "Report"
- THEN they are sent to sign in instead of seeing the report form
- AND after completing sign-in through the emailed link they are brought back to `/works/:id/report` for W using the stored `next` value

### Signed-out report submission is refused
- GIVEN a signed-out reader with no session cookie
- WHEN they POST a report for W to `/works/:id/report`
- THEN no `reports` row is stored
- AND they are sent to sign in

### Report form asks for a reason and optional details
- GIVEN signed-in reader U on `/works/:id/report`
- WHEN the form renders
- THEN it asks for a reason and optional details
- AND it works with JavaScript off

### Submitting a report stores it and confirms
- GIVEN signed-in reader U on W's report form
- WHEN U submits a reason
- THEN an open `reports` row is stored for W with `reporter_id` set to U
- AND a confirmation page explains what happens next

### Report without details is accepted
- GIVEN signed-in reader U on W's report form
- WHEN U submits a reason and leaves details empty
- THEN the report is stored with `reporter_id` set to U

### Fewer than N open reports keeps the work live
- GIVEN work W with N-1 open reports
- WHEN a moderator has not yet acted
- THEN W stays live

### N open reports hides the work automatically
- GIVEN work W with N-1 open reports
- WHEN a signed-in reader submits the Nth report
- THEN W is hidden automatically until a moderator looks at it

### DMCA form is public
- GIVEN any visitor
- WHEN they open `/dmca`
- THEN a statutory takedown notice form is shown
- AND it works with JavaScript off

### Submitting a DMCA notice creates a takedown
- GIVEN a visitor on `/dmca`
- WHEN they submit a notice naming work W
- THEN a `takedowns` row is stored for W
- AND it appears in the moderators' takedowns queue

### Takedown approval removes the work
- GIVEN a takedown on work W
- WHEN a moderator approves it and W is set to `removed`
- THEN `works/<ao3_work_id>/` and the raw upload are deleted from R2 and the work's cached pages, fragments, images and download URLs are purged
- AND W's page returns 410

### Taken-down work cannot be re-uploaded
- GIVEN a takedown on AO3 work ID 12345
- WHEN a new epub of work 12345 is ingested
- THEN it is rejected with `opted_out`
