# Scenario: Upload request, transfer and confirm (presigned PUT)

Relates to: docs/ARCHITECTURE.md § Ingestion pipeline (steps 1-3), § Surge controls (Orphaned uploads); docs/FRONTEND-DISCOVERY.md § Key journeys (3. Upload works), § Where the frontend changes the architecture (1. Forms with Turnstile need JS), § Page inventory (Upload)

## Setup
- A signed-in user U with an active session and remaining daily upload quota
- Turnstile is configured on upload requests; passing and failing test tokens are available
- R2 bucket with an `uploads/` prefix, a CORS rule allowing `app.<domain>`, and a lifecycle rule expiring `uploads/` objects after 7 days
- The ingest queue is observable so enqueued `{upload_id}` messages can be asserted
- Fixture epubs: a valid AO3 export, one of exactly 25 MB, and one just over 25 MB

## Cases

### Upload request returns a presigned PUT URL
- GIVEN user U with a passing Turnstile token and remaining quota
- WHEN U calls `POST /uploads` declaring a size of 25 MB or less
- THEN an `uploads` row is inserted for U
- AND the response contains a presigned R2 `PUT` URL valid for 10 minutes
- AND the URL is locked to `Content-Type: application/epub+zip`

### Declared size of exactly 25 MB is accepted
- GIVEN user U with a passing Turnstile token and remaining quota
- WHEN U calls `POST /uploads` declaring exactly 25 MB
- THEN a presigned PUT URL is returned

### Declared size over 25 MB is refused
- GIVEN user U with a passing Turnstile token and remaining quota
- WHEN U calls `POST /uploads` declaring a size over 25 MB
- THEN no presigned URL is returned

### Upload request without a session is refused
- GIVEN a visitor with no session
- WHEN they call `POST /uploads`
- THEN no `uploads` row is inserted and no presigned URL is returned

### Upload request without Turnstile is refused
- GIVEN user U
- WHEN U calls `POST /uploads` with a missing or failing Turnstile token
- THEN no `uploads` row is inserted and no presigned URL is returned

### Upload request over the daily quota is refused
- GIVEN user U who has used all of today's upload quota
- WHEN U calls `POST /uploads`
- THEN no `uploads` row is inserted and no presigned URL is returned

### Presigned PUT with the wrong content type fails
- GIVEN a presigned PUT URL issued to U
- WHEN the browser PUTs the file with a `Content-Type` other than `application/epub+zip`
- THEN R2 rejects the PUT

### Presigned PUT after 10 minutes fails
- GIVEN a presigned PUT URL issued more than 10 minutes ago
- WHEN the browser PUTs the file to it
- THEN R2 rejects the PUT

### Browser with JS uploads straight to R2 with progress
- GIVEN user U on `/upload` with JavaScript on
- WHEN U picks an epub and submits
- THEN the browser PUTs the file directly to R2 using the presigned URL
- AND the page shows upload progress
- AND the file bytes do not pass through the web Worker

### Upload of several files in one go
- GIVEN user U on `/upload` with JavaScript on and quota for at least three uploads
- WHEN U picks three epub files and submits
- THEN each file gets its own `uploads` row and its own presigned PUT URL
- AND each file is PUT straight to R2 with its own progress
- AND each finished transfer goes through `POST /uploads/:id/complete`

### Upload page without JavaScript explains it is needed
- GIVEN user U with JavaScript off
- WHEN U opens `/upload`
- THEN the page shows a `<noscript>` message saying uploading needs JavaScript
- AND no file can be uploaded from the page

### Confirm enqueues the upload
- GIVEN an upload whose object is in R2 and is 25 MB or less
- WHEN `POST /uploads/:id/complete` is called
- THEN the Worker HEADs the object and checks its size
- AND a `{upload_id}` message is put on the ingest queue

### Confirm deletes an oversized object
- GIVEN an upload whose presigned PUT stored an object larger than 25 MB, despite a smaller declared size
- WHEN `POST /uploads/:id/complete` is called
- THEN the oversized object is deleted from R2

### Confirm is never called
- GIVEN an object PUT to `uploads/` whose client never calls `/complete`
- WHEN 7 days have passed since the object was written
- THEN the R2 lifecycle rule has expired the object

### Upload requests are rate-limited
- GIVEN user U, or U's IP address, has reached the upload-request rate limit in the current window
- WHEN U calls `POST /uploads` again
- THEN the request is throttled
