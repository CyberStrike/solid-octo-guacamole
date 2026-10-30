# Scenario: Bulk upload from a zip of epubs

Relates to: docs/ARCHITECTURE.md § MVP vs later (Later); docs/FRONTEND-DISCOVERY.md § What to validate first (5. Uploader motivation)

## Setup
- A signed-in uploader U with remaining daily quota
- A zip file containing several AO3 epub exports

## Cases

### Zip of epubs is accepted as a bulk upload
- GIVEN uploader U and a zip containing several AO3 epubs
- WHEN U uploads the zip
- THEN each epub inside goes through the normal ingest pipeline as its own upload

### Each epub in the bulk upload gets its own status
- GIVEN a bulk upload whose epubs end as live, held for review and rejected
- WHEN U opens `/me/uploads`
- THEN each epub is listed with its own status
