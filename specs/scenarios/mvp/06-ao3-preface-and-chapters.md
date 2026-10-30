# Scenario: OPF indexing, AO3 preface parsing and chapter boundaries (not_ao3, opted_out)

Relates to: docs/ARCHITECTURE.md § EPUB processor (steps 3-5, Review reasons, Rejection codes), § Reading ("May be imperfect" notice), § Dedupe, § Testing, § Open questions (Anonymous and unrevealed works)

## Setup
- About 50 real AO3 epub fixtures covering older and current export formats, one-shots and many-chapter works, images and work skins, anonymous works and series members, non-English and right-to-left text
- Hand-built files: a chapter count that doesn't match `Stats:`, a commercial (non-AO3) epub, an epub with no AO3 preface whose AO3 work URL is only in the OPF identifier or source (rejected `not_ao3`), an AO3 epub whose OPF work ID differs from its preface's, and an AO3 epub whose preface has no `Rating:` (a missing OPF is covered in mvp/05)
- A work with review reasons goes live with the notice "Chapters may be imperfect; a moderator will check." and is listed in the moderators' *Works to check* queue
- XML is parsed with `fast-xml-parser`; XHTML goes through `HTMLRewriter`
- An `optouts` row with an active opt-out for pseud P, and AO3 work ID T on the takedown list because a moderator removed that work after a DMCA notice

## Cases

### OPF is found through container.xml
- GIVEN a valid AO3 epub
- WHEN the processor indexes it
- THEN it reads `META-INF/container.xml` to locate the OPF
- AND takes the metadata, file list, reading order and table of contents (NCX or EPUB3 nav) from it

### Provenance from the preface line
- GIVEN an AO3 epub whose preface says "Posted originally on the Archive of Our Own" with `archiveofourown.org/works/<id>`
- WHEN the processor parses the preface
- THEN `<id>` becomes the work's `ao3_work_id`

### AO3 URL only in the OPF is rejected as not_ao3
- GIVEN an epub with no AO3 preface but `archiveofourown.org/works/<id>` in the OPF identifier or source
- WHEN the processor parses it
- THEN it is rejected with `not_ao3`, because the work URL must come from the preface's "Posted originally on the Archive of Our Own" line
- AND no work is created

### OPF work URL matching the preface is accepted
- GIVEN an AO3 epub whose preface "Posted originally" line and OPF identifier both give `archiveofourown.org/works/<id>`
- WHEN the processor parses it
- THEN `<id>` becomes the work's `ao3_work_id`
- AND the version has no `work_id_mismatch` review reason

### OPF work URL disagreeing with the preface is a review reason
- GIVEN an AO3 epub whose preface "Posted originally" line gives `archiveofourown.org/works/<id>` and whose OPF identifier or source gives a different AO3 work ID
- WHEN the processor parses it
- THEN `<id>` from the preface becomes the work's `ao3_work_id`
- AND the version gets the `work_id_mismatch` review reason
- AND the work goes live with the notice and is listed in *Works to check*

### Native file with no rating goes live with missing_rating
- GIVEN an AO3 epub with a "Posted originally" line but no `Rating:` in its preface
- WHEN the processor parses it
- THEN the version gets the `missing_rating` review reason
- AND the work goes live with the notice, is shown as "Not Rated" and is listed in *Works to check*

### Missing AO3 URL is rejected as not_ao3
- GIVEN a commercial or other non-AO3 epub with no AO3 preface and no `archiveofourown.org/works/<id>` anywhere
- WHEN the processor parses it
- THEN it is rejected with `not_ao3`

### FanFicFare epub is rejected in v1
- GIVEN a FanFicFare epub of an AO3 work, with no AO3 preface but `archiveofourown.org/works/<id>` in its `dc:source`
- WHEN the processor parses it in v1
- THEN it is rejected with `not_ao3`, because it has no AO3 preface

### Fields are matched by label text
- GIVEN an AO3 epub with `dt`/`dd` pairs under `Rating:`, `Archive Warning:`, `Category:`, `Fandom:`, `Relationship:`, `Character:`, `Additional Tags:`, `Language:`, `Series:` and `Stats:`
- WHEN the processor parses the preface
- THEN each field is read from the `dd` paired with its label

### Renamed CSS classes do not break parsing
- GIVEN an AO3 epub whose preface classes were renamed by Calibre but whose labels are unchanged
- WHEN the processor parses the preface
- THEN every field is read exactly as from the original-class fixture

### Summary, notes and end notes come from headed blocks
- GIVEN an AO3 epub with summary, notes and end notes blocks
- WHEN the processor parses it
- THEN each is taken from its headed block

### Unknown labels are kept in raw_meta
- GIVEN an AO3 epub whose preface has a label the parser doesn't recognise
- WHEN the processor parses it
- THEN the label and its value are stored in the work's `raw_meta` JSON
- AND parsing succeeds

### Tags are stored as written with a normalized form
- GIVEN an AO3 epub with a fandom tag "Harry Potter - J. K. Rowling"
- WHEN the work is saved
- THEN the tag's `name` is exactly as written
- AND `name_norm` is lowercased with whitespace and punctuation folded

### Opted-out pseud is rejected
- GIVEN an active opt-out for pseud P
- WHEN an AO3 epub authored by P is processed
- THEN it is rejected with `opted_out` and no work is created

### Work under takedown is rejected
- GIVEN AO3 work ID T on the takedown list, after a moderator removed the work
- WHEN an AO3 epub of work T is processed
- THEN it is rejected with `opted_out`

### Anonymous works stay anonymous
- GIVEN an AO3 epub whose preface shows "Anonymous" as author
- WHEN the work is saved
- THEN the author is stored and shown as "Anonymous" and no attempt is made to identify the author

### Chapter boundaries from table-of-contents anchors
- GIVEN an AO3 epub where Calibre split one chapter across `*_split_000.xhtml` and `*_split_001.xhtml`, and the table of contents points at `file.xhtml#anchor`
- WHEN the processor finds chapter boundaries
- THEN a new chapter starts only where a table-of-contents anchor's element appears
- AND the split files make up one chapter

### One file holding several chapters is split by anchors
- GIVEN an AO3 epub where one reading-order file holds two chapters, each with a table-of-contents anchor
- WHEN the processor finds chapter boundaries
- THEN that file produces two chapters

### Chapter headings are used when the table of contents is missing
- GIVEN an AO3 epub with no table of contents, or one that doesn't match the content, but with AO3 chapter headings
- WHEN the processor finds chapter boundaries
- THEN chapters are split at the AO3 chapter headings

### One chapter per file as a last resort goes live with the notice
- GIVEN an AO3 epub with neither a usable table of contents nor AO3 chapter headings
- WHEN the processor finds chapter boundaries
- THEN each reading-order file becomes one chapter
- AND the version gets a `chapters_one_per_file` review reason
- AND the work goes live with the notice and is listed in *Works to check*

### Chapter count matching Stats goes live without the notice
- GIVEN an AO3 epub whose parsed chapter count equals the count in `Stats:`, with no other review reason
- WHEN the job finishes
- THEN the work goes live with no notice

### Chapter count not matching Stats goes live with the notice
- GIVEN the hand-built fixture whose parsed chapter count differs from `Stats:`
- WHEN the job finishes
- THEN the version gets a `chapter_count_mismatch` review reason
- AND the work goes live with the notice and is listed in *Works to check*
- AND the upload's status is `live`, not `held_for_review`

### Other review reasons also go live with the notice
- GIVEN AO3 epubs with, in turn: text outside the chapters, a manifest item the parser can't read, a missing title, and preface and OPF titles that differ
- WHEN each job finishes
- THEN each version records its review reason
- AND each work goes live with the notice and is listed in *Works to check*

### Right-to-left and non-English text survive parsing
- GIVEN the right-to-left and non-English fixtures
- WHEN the processor parses them
- THEN the language and text are kept intact

### Parser output is deterministic
- GIVEN any fixture epub
- WHEN the processor parses it twice
- THEN both outputs are identical and match the stored snapshot
