# Scenario: Work page

Relates to: docs/ARCHITECTURE.md § Opening, § MVP vs later (3. Work page; Later: Export and shut down), § Author requests & takedowns; docs/FRONTEND-DISCOVERY.md § Decisions so far (Warnings, Original AO3 link), § Key journeys (1, 4, 5), § Page inventory (Work page, Hidden work, Removed work), § Typographic system (Hierarchy), § Reading experience

## Setup
- A live work W (`ao3_work_id` 12345) with title, author pseud, rating Mature, archive warning "Graphic Depictions Of Violence", fandoms, relationships, characters, freeform tags, a long summary, stats and 5 chapters
- A live anonymous work A whose author is "Anonymous"
- A work H in status `hidden` after a removal request, and a work R in status `removed`
- A signed-in reader with a saved reading position on W, and a signed-out reader

## Cases

### Work page shows full metadata
- GIVEN live work W
- WHEN a reader opens `/works/:id`
- THEN the page shows title, author, rating, archive warnings, fandoms, the full summary, tags, stats and the chapter list

### Rating and warnings are always visible
- GIVEN live work W
- WHEN a reader opens its work page at any viewport width
- THEN the rating and archive warnings are shown in full as text, never collapsed, behind a hover or truncated

### Hierarchy follows the set order
- GIVEN live work W
- WHEN its work page renders
- THEN the order is title, author, rating and warnings, fandom, summary, tags, stats

### Original AO3 link is live with a note
- GIVEN live work W
- WHEN its work page renders
- THEN it links to `https://archiveofourown.org/works/12345`
- AND a note says the link works again once AO3 is back

### No redirect to AO3 when AO3 is reachable again
- GIVEN live work W while AO3 is reachable again and the operator has not started the wind-down
- WHEN a reader opens `/works/:id`
- THEN the archive's own work page is served, not a redirect to AO3
- AND the original AO3 link and its note are unchanged

### Work page states it is unofficial
- GIVEN live work W
- WHEN its work page renders
- THEN it says plainly that this is an unofficial stopgap
- AND it uses no AO3 or OTW name, logo or styling to imply affiliation

### Anonymous author shown as Anonymous
- GIVEN live anonymous work A
- WHEN its work page renders
- THEN the author is shown as "Anonymous"

### Tags are an inline list of links
- GIVEN live work W
- WHEN its work page renders
- THEN tags are a comma-separated inline list where every tag is a link
- AND each tag's type is given by its position and a visually hidden label, not by colour

### Chapter list links to each chapter
- GIVEN live work W with 5 chapters
- WHEN its work page renders
- THEN each chapter links to `/works/:id/chapters/:n`
- AND there is a link to the entire work at `/works/:id/full`

### Remove link prefills the request form
- GIVEN live work W
- WHEN a reader follows "Ask for this to be removed"
- THEN they reach `/remove?work=:id` with W prefilled, without signing in

### Report link opens the report form for signed-in readers
- GIVEN live work W and a signed-in reader
- WHEN the reader follows "Report"
- THEN they reach `/works/:id/report`

### Report link sends signed-out readers to sign in first
- GIVEN live work W and a signed-out reader
- WHEN the reader follows "Report"
- THEN they are sent to sign in
- AND after signing in they are brought back to `/works/:id/report` using the stored `next` value

### Download original link is offered
- GIVEN live work W
- WHEN its work page renders
- THEN a "Download original epub" link points to `content.<domain>`

### Continue where you left off for signed-in readers
- GIVEN a signed-in reader with a saved position in chapter 3 of W
- WHEN they open W's work page
- THEN a "Continue where you left off" link to that position appears
- AND the page does not jump them there without asking

### No continue link without a saved position
- GIVEN a signed-out reader
- WHEN they open W's work page
- THEN no "Continue where you left off" link appears

### Hidden work returns 451
- GIVEN work H hidden after a removal request
- WHEN anyone opens `/works/:id`
- THEN the response status is 451
- AND the page says "Temporarily hidden after a removal request" with no details of the work

### Removed work returns 410
- GIVEN work R in status `removed`
- WHEN anyone opens `/works/:id`
- THEN the response status is 410
- AND the page says "This work has been removed" with no details of the work

### Unknown work shows the not-found page
- GIVEN no work with the requested ID
- WHEN a reader opens `/works/:id`
- THEN the not-found page shows a search box and a home link
