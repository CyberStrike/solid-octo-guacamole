# Scenario: EPUB unzip limits (not_epub, zip_bomb, too_large)

Relates to: docs/ARCHITECTURE.md § EPUB processor (step 2), § Rejection codes, § Testing

## Setup
- `packages/epub` unzips with `fflate` and runs under `@cloudflare/vitest-pool-workers`
- Hand-built bad files: zip bombs, a zip whose index under-reports sizes, path traversal names, wrong or missing `mimetype` entry, a non-zip file
- Size-edge fixtures built for each limit: entry counts of 2,000 and 2,001; uncompressed totals of exactly 100 MB and just over; a single entry of exactly 20 MB and just over

## Cases

### Valid AO3 epub passes the unzip checks
- GIVEN a real AO3 epub fixture
- WHEN the processor unzips it
- THEN no unzip rule is broken and processing continues to indexing

### Zip index is checked before anything is decompressed
- GIVEN a zip whose file index declares more than 100 MB uncompressed in total
- WHEN the processor reads it
- THEN it is rejected from the file index alone, before any entry is decompressed

### Exactly 2,000 entries is accepted
- GIVEN an otherwise valid epub with exactly 2,000 zip entries
- WHEN the processor unzips it
- THEN the entry count rule is not broken

### More than 2,000 entries is rejected
- GIVEN an epub with 2,001 zip entries
- WHEN the processor unzips it
- THEN it is rejected with `not_epub` or `zip_bomb`

### Exactly 100 MB uncompressed in total is accepted
- GIVEN an otherwise valid epub whose entries total exactly 100 MB uncompressed
- WHEN the processor unzips it
- THEN the total size rule is not broken

### More than 100 MB uncompressed in total is rejected
- GIVEN an epub whose entries total more than 100 MB uncompressed
- WHEN the processor unzips it
- THEN it is rejected with `not_epub` or `zip_bomb`

### Exactly 20 MB in one entry is accepted
- GIVEN an otherwise valid epub with one entry of exactly 20 MB uncompressed
- WHEN the processor unzips it
- THEN the per-entry size rule is not broken

### More than 20 MB in one entry is rejected
- GIVEN an epub with one entry over 20 MB uncompressed
- WHEN the processor unzips it
- THEN it is rejected with `not_epub` or `zip_bomb`

### Zip that lies about its sizes is caught during decompression
- GIVEN a zip whose index declares small sizes but whose entries decompress to more than the limits
- WHEN the processor decompresses it
- THEN bytes are counted as they decompress and it is rejected with `not_epub` or `zip_bomb` once a limit is passed

### Entry name with .. is rejected
- GIVEN an epub containing an entry named `../../evil.xhtml`
- WHEN the processor unzips it
- THEN it is rejected with `not_epub` or `zip_bomb`

### Entry name with a leading slash is rejected
- GIVEN an epub containing an entry named `/etc/evil.xhtml`
- WHEN the processor unzips it
- THEN it is rejected with `not_epub` or `zip_bomb`

### Entry name with a drive letter is rejected
- GIVEN an epub containing an entry named `C:\evil.xhtml`
- WHEN the processor unzips it
- THEN it is rejected with `not_epub` or `zip_bomb`

### Wrong mimetype entry is rejected
- GIVEN a zip whose `mimetype` entry is not `application/epub+zip`
- WHEN the processor unzips it
- THEN it is rejected with `not_epub` or `zip_bomb`

### Missing mimetype entry is rejected
- GIVEN a zip with no `mimetype` entry
- WHEN the processor unzips it
- THEN it is rejected with `not_epub` or `zip_bomb`

### Object larger than 25 MB is not processed
- GIVEN an uploads object larger than 25 MB
- WHEN it reaches the size checks
- THEN it is not parsed and the uploader sees a plain-language size rejection

### Rejected upload records its code
- GIVEN an epub rejected at the unzip stage
- WHEN the job ends
- THEN the upload's status is the rejection code and the work is not created
