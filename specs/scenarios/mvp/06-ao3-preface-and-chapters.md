# Scenario: OPF indexing, AO3 preface parsing and chapter boundaries (not_ao3, opted_out)

Relates to: docs/ARCHITECTURE.md § EPUB processor (steps 3-5), § Dedupe, § Testing, § Open questions (Anonymous and unrevealed works)

## Setup
- About 50 real AO3 epub fixtures covering older and current export formats, one-shots and many-chapter works, images and work skins, anonymous works and series members, non-English and right-to-left text
- Hand-built bad files: a missing OPF, a chapter count that doesn't match `Stats:`, a commercial (non-AO3) epub
- XML is parsed with `fast-xml-parser`; XHTML goes through `HTMLRewriter`
- An `optouts` row with an active opt-out for pseud P, and a takedown on AO3 work ID T

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

### Provenance from the OPF identifier or source
- GIVEN an AO3 epub with no preface URL but `archiveofourown.org/works/<id>` in the OPF identifier or source
- WHEN the processor parses it
- THEN `<id>` becomes the work's `ao3_work_id`

### Missing AO3 URL is rejected as not_ao3
- GIVEN a commercial or other non-AO3 epub with no `archiveofourown.org/works/<id>` anywhere in the preface or OPF
- WHEN the processor parses it
- THEN it is rejected with `not_ao3`

### FanFicFare epub is rejected in v1
- GIVEN a FanFicFare epub with no `archiveofourown.org/works/<id>` in the preface or the OPF identifier or source
- WHEN the processor parses it in v1
- THEN it is rejected with `not_ao3`

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
- GIVEN a takedown on AO3 work ID T
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

### One chapter per file as a last resort flags the work
- GIVEN an AO3 epub with neither a usable table of contents nor AO3 chapter headings
- WHEN the processor finds chapter boundaries
- THEN each reading-order file becomes one chapter
- AND the work is flagged for review

### Chapter count matching Stats goes live
- GIVEN an AO3 epub whose parsed chapter count equals the count in `Stats:`
- WHEN the job finishes
- THEN the work can go live

### Chapter count not matching Stats is flagged
- GIVEN the hand-built fixture whose parsed chapter count differs from `Stats:`
- WHEN the job finishes
- THEN the work is flagged for review instead of going live

### Right-to-left and non-English text survive parsing
- GIVEN the right-to-left and non-English fixtures
- WHEN the processor parses them
- THEN the language and text are kept intact

### Parser output is deterministic
- GIVEN any fixture epub
- WHEN the processor parses it twice
- THEN both outputs are identical and match the stored snapshot
