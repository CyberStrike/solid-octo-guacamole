# Scenario: Surge controls, rate limits and upload quotas

Relates to: docs/ARCHITECTURE.md § Decisions so far (Load target), § Surge controls, § Ingestion pipeline, § Auth (magic link)

## Setup
- Turnstile is configured on signup, login, upload and `/remove` requests
- The Workers rate-limiting binding covers login, upload requests and search, keyed per IP and per user, over 10- or 60-second windows
- Upload quotas are counted in Postgres (`users.upload_quota_used`)
- Users: an established user E, a brand-new user N, a trusted user T
- The default daily quota is about 50 epubs per account

## Cases

### Turnstile guards login and signup
- GIVEN a visitor
- WHEN they request a magic link without a passing Turnstile token
- THEN the request is refused

### Turnstile guards upload requests
- GIVEN signed-in user E
- WHEN E requests an upload without a passing Turnstile token
- THEN the request is refused

### Login is throttled per IP
- GIVEN one IP that has sent more login requests than the limit within a window
- WHEN it sends another
- THEN it is throttled

### Upload requests are throttled per user
- GIVEN user E who has sent more upload requests than the rate limit within a window
- WHEN E sends another
- THEN it is throttled, even with quota left

### Search is throttled per IP
- GIVEN one IP that has sent more searches than the limit within a window
- WHEN it searches again
- THEN it is throttled

### Throttling recovers after the window
- GIVEN an IP throttled on search
- WHEN the rate-limit window has passed
- THEN its next search succeeds

### Daily quota allows uploads up to the limit
- GIVEN user E with one upload left in today's quota
- WHEN E requests an upload
- THEN the request succeeds and the quota is used up

### Daily quota refuses uploads past the limit
- GIVEN user E who has used all of today's quota
- WHEN E requests another upload
- THEN the request is refused

### Quota is a hard limit under concurrency
- GIVEN user E with one upload left in today's quota
- WHEN E sends two upload requests at the same time from different locations
- THEN exactly one succeeds, because the quota is counted in Postgres rather than the approximate rate limiter

### Brand-new accounts get a lower quota
- GIVEN brand-new user N
- WHEN N's daily quota is checked
- THEN it is lower than the default for established accounts

### Trusted users get a higher quota
- GIVEN trusted user T
- WHEN T's daily quota is checked
- THEN it is higher than the default

### Oversized objects are cleaned up at confirm
- GIVEN an object PUT through a presigned URL that exceeds 25 MB
- WHEN `/complete` is called
- THEN the object is deleted

### Abandoned uploads expire
- GIVEN an object under `uploads/` whose client never called `/complete`
- WHEN 7 days have passed
- THEN the R2 lifecycle rule has deleted it

### Upload flood becomes a backlog, not an outage
- GIVEN thousands of uploads confirmed in a short burst
- WHEN the ingest queue fills
- THEN browsing, search and reading keep responding while the queue drains at bounded consumer concurrency

### Content origin is edge-cached
- GIVEN an image or original download on `content.<domain>`
- WHEN it is served
- THEN it has `Cache-Control: public, max-age=31536000, immutable`

### Listings use a short cache
- GIVEN a work or tag listing
- WHEN it is served
- THEN it has a short cache with stale-while-revalidate

### Operations dashboard
- GIVEN the deployed Workers
- WHEN an operator opens the dashboard
- THEN queue depth, ingest failure rate and search p95 are shown, with Workers Logs and traces enabled
