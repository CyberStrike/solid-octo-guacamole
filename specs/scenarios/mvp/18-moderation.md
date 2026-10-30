# Scenario: Moderation queues and actions

Relates to: docs/ARCHITECTURE.md § Data model (users.role, users.banned_at), § Author requests & takedowns (Abuse of instant hiding, Moderation); docs/FRONTEND-DISCOVERY.md § Who uses it (Moderator), § Key journeys (6. Moderate), § Page inventory (Moderation queues)

## Setup
- A signed-in moderator M (user with the moderator role)
- A signed-in user U without the moderator role, and a signed-out visitor
- Open reports, takedowns and requests created at different times
- Five removal requests from the same email and IP that hid five different works, plus one unrelated request
- An uploader Z

## Cases

### Moderator sees three queues
- GIVEN moderator M
- WHEN M opens `/admin/reports`, `/admin/takedowns` and `/admin/requests`
- THEN each shows a plain table of its items

### Queues are oldest first
- GIVEN open items created at different times
- WHEN M opens any queue
- THEN the oldest item is listed first

### Requests queue covers removals and opt-outs
- GIVEN open `remove_work` and `opt_out` requests
- WHEN M opens `/admin/requests`
- THEN both kinds are listed

### Each item has a detail page with actions
- GIVEN an item in any queue
- WHEN M opens its detail page
- THEN the page offers hide, remove, restore, approve, reject, block requester and ban uploader actions

### Non-moderator is refused
- GIVEN signed-in user U without the moderator role
- WHEN U opens any `/admin/` page
- THEN no queue or item is shown

### Signed-out visitor is refused
- GIVEN a signed-out visitor
- WHEN they open any `/admin/` page
- THEN no queue or item is shown

### Moderator hides a work
- GIVEN a live work W
- WHEN M uses the hide action
- THEN W's status is `hidden`

### Moderator restores a hidden work
- GIVEN work W hidden after a removal request
- WHEN M rejects the request and restores W
- THEN W is `live` again and readable

### Moderator removes a work
- GIVEN a work W
- WHEN M uses the remove action
- THEN W is `removed`, its R2 files and raw upload are deleted and its cached pages, fragments, images and download URLs are purged

### Related requests are listed together
- GIVEN one of the five requests from the same email and IP
- WHEN M opens its detail page
- THEN the other four requests from the same email or IP are listed on it
- AND the unrelated request is not

### Bulk restore undoes a mass-hiding spree
- GIVEN five works hidden by requests from the same email and IP
- WHEN M restores them in bulk from a request's detail page
- THEN all five works are live again

### Moderator blocks a requester
- GIVEN a request from an abusive requester
- WHEN M uses the block requester action
- THEN the requester is blocked

### Moderator bans an uploader
- GIVEN uploader Z
- WHEN M uses the ban uploader action
- THEN Z's `banned_at` is set

### Moderation works without JS
- GIVEN moderator M with JavaScript off
- WHEN M works through a queue and takes actions
- THEN every table, detail page and action works
