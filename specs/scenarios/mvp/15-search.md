# Scenario: Metadata search

Relates to: docs/ARCHITECTURE.md § Decisions so far (Search scope), § Why these pieces (Neon Postgres), § EPUB processor (Scope for v1), § Surge controls, § MVP vs later (6. Search); docs/FRONTEND-DISCOVERY.md § Page inventory (Search results)

## Setup
- Live works indexed in Postgres with a `search` tsvector over title, author, tags and summary, plus `pg_trgm` for fuzzy matching
- Work W1 titled "The Lighthouse Keeper" by pseud "saltwater", tagged "Found Family", whose summary mentions "storm"
- Work W2 whose chapter text, but no metadata, contains the word "zeppelin"
- Enough matching works to fill more than one results page
- The rate-limiting binding is configured for search per IP and per user

## Cases

### Search by title
- GIVEN work W1
- WHEN a reader searches `/search?q=lighthouse keeper`
- THEN W1 is in the results

### Search by author
- GIVEN work W1
- WHEN a reader searches for "saltwater"
- THEN W1 is in the results

### Search by tag
- GIVEN work W1
- WHEN a reader searches for "found family"
- THEN W1 is in the results

### Search by summary
- GIVEN work W1
- WHEN a reader searches for "storm"
- THEN W1 is in the results

### Fuzzy matching tolerates typos
- GIVEN work W1
- WHEN a reader searches for "lighthose keeper"
- THEN W1 is in the results through trigram matching

### Chapter text is not searched
- GIVEN work W2 whose only mention of "zeppelin" is in chapter text
- WHEN a reader searches for "zeppelin"
- THEN W2 is not in the results

### Search is a GET form
- GIVEN the search box on any page
- WHEN a reader submits it with JavaScript off
- THEN the browser loads `/search?q=…` and the results render server-side

### Results are paged with real URLs
- GIVEN a query matching more works than fit on one page
- WHEN the results render
- THEN pagination links are real URLs for each page

### Results can be filtered
- GIVEN a results page
- WHEN the reader uses the filter form
- THEN the filters are applied through a GET request and appear in the URL

### Result cards show rating and warnings
- GIVEN any search result
- WHEN it renders
- THEN its card shows rating and archive warnings in full

### Search is rate-limited
- GIVEN one IP or user that has reached the search rate limit in the current window
- WHEN they search again
- THEN the request is throttled

### Search needs no account
- GIVEN a signed-out visitor
- WHEN they search
- THEN results are shown without sign-in
