# Scenario: Versioning and dedupe (duplicate, held_for_review)

Relates to: docs/ARCHITECTURE.md § Decisions so far (New versions), § Dedupe, § EPUB processor (step 7), § Author requests & takedowns (No claims while AO3 is down)

## Setup
- A live work W with `ao3_work_id` 12345, current version v1 with 3 chapters and an Updated date of D1
- Fixtures of work 12345:
  - v2-newer: 4 chapters, chapters 1-3 near-identical to v1 after sanitizing
  - v2-later-date: 3 chapters, later Updated/Completed date, chapters near-identical
  - v2-small-edit: 4 chapters, chapter 2 has a small typo fix
  - v2-tampered: 4 chapters, chapter 2 rewritten
  - v2-tags-changed: 4 chapters, chapters near-identical, one tag different
  - v2-authors-changed: 4 chapters, chapters near-identical, different author
  - v0-older: 2 chapters, earlier Updated date
- The exact bytes of v1's file (same SHA-256)

## Cases

### First upload creates the work
- GIVEN no work exists with `ao3_work_id` 67890
- WHEN an AO3 epub of work 67890 is ingested
- THEN a work keyed by `ao3_work_id` 67890 is created with its first version

### Newer upload with more chapters replaces the current version
- GIVEN work W at v1
- WHEN v2-newer is ingested
- THEN a new version is added and `current_version_id` points at it
- AND the upload's status is `live`

### Newer upload with a later date replaces the current version
- GIVEN work W at v1
- WHEN v2-later-date is ingested
- THEN `current_version_id` points at the new version

### Small edits in shared chapters are allowed
- GIVEN work W at v1
- WHEN v2-small-edit is ingested
- THEN the per-chapter normalized-text comparison is within the similarity threshold
- AND `current_version_id` points at the new version

### Newer upload with changed shared chapters is held
- GIVEN work W at v1
- WHEN v2-tampered is ingested
- THEN the upload's status is `held_for_review`
- AND `current_version_id` still points at v1

### Newer upload with changed tags is held
- GIVEN work W at v1
- WHEN v2-tags-changed is ingested
- THEN the upload's status is `held_for_review`
- AND `current_version_id` still points at v1

### Newer upload with changed authors is held
- GIVEN work W at v1
- WHEN v2-authors-changed is ingested
- THEN the upload's status is `held_for_review`
- AND `current_version_id` still points at v1

### Older upload is marked duplicate
- GIVEN work W at v1
- WHEN v0-older is ingested
- THEN the upload is marked `duplicate`
- AND it is stored but not used
- AND it is not a rejection: the uploader is told the work is already in the archive
- AND `current_version_id` still points at v1

### Same-version upload is marked duplicate
- GIVEN work W at v1
- WHEN a different file of work 12345 with the same chapter count and the same Updated date is ingested
- THEN the upload is marked `duplicate`
- AND it is stored but not used, and the uploader is told the work is already in the archive

### Exact re-upload is caught by SHA-256
- GIVEN work W at v1
- WHEN a file with the same SHA-256 as v1's file is uploaded
- THEN it is caught early by the hash, before full processing

### Nobody gets special treatment
- GIVEN two uploaders, one claiming to be the author of work W and one not
- WHEN each uploads v2-tampered
- THEN both uploads are `held_for_review` in exactly the same way

### Every version is kept
- GIVEN work W after v2-newer replaced v1
- WHEN the work's versions are listed
- THEN both v1 and the new version exist, each with its own `r2_prefix` of `works/<ao3_work_id>/<upload_id>/` keyed by the upload that produced it
- AND version numbers live only in Postgres, not in any R2 key

### A bad replacement can be rolled back
- GIVEN work W whose current version was replaced by a bad upload
- WHEN the replacement is rolled back
- THEN `current_version_id` points at the earlier version again and its chapters are served

### Two uploads of the same work processed at once
- GIVEN work W at v1
- WHEN v2-newer and v2-later-date are ingested concurrently
- THEN `current_version_id` points at exactly one complete version, and every chapter served belongs to that version
