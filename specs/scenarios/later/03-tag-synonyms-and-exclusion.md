# Scenario: Tag synonym merging and excluded-tag filtering

Relates to: docs/ARCHITECTURE.md § Dedupe (Tags), § MVP vs later (Later); docs/FRONTEND-DISCOVERY.md § What to validate first (4. Discovery without wrangled tags)

## Setup
- A moderator M
- Two fandom tags with different `name_norm` values that mean the same fandom: "Harry Potter - J. K. Rowling" and "Harry Potter"
- Live works tagged with each, and a work tagged "Major Character Death"

## Cases

### Moderator merges synonym tags
- GIVEN tags "Harry Potter - J. K. Rowling" and "Harry Potter"
- WHEN moderator M merges them as synonyms
- THEN browsing either tag lists the works tagged with both

### Original tag text is kept after a merge
- GIVEN two tags merged as synonyms
- WHEN a work page renders
- THEN each work's tags are still shown exactly as written in its epub

### Non-moderator cannot merge tags
- GIVEN a signed-in user without the moderator role
- WHEN they try to merge two tags
- THEN the merge does not happen

### Readers filter out excluded tags
- GIVEN a listing that includes a work tagged "Major Character Death"
- WHEN the reader excludes that tag using the GET filter form
- THEN the work is not listed and the exclusion is in the URL
