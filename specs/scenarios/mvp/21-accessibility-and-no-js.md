# Scenario: Accessibility, no-JS behaviour and device performance

Relates to: docs/FRONTEND-DISCOVERY.md § Decisions so far (JavaScript, Pagination), § Principles, § Page inventory, § Typographic system, § Accessibility and devices; docs/ARCHITECTURE.md § Reading

## Setup
- Every page in the page inventory: home, search, tag listing, work, warnings, chapter, entire work, reader settings, sign in, upload, my uploads, remove, report, DMCA, admin queues, about/terms/privacy, hidden, removed, not found
- A browser with JavaScript off, one with CSS off, and a 360 px wide viewport
- An automated WCAG 2.2 AA checker

## Cases

### Every page works with JavaScript off
- GIVEN JavaScript is off
- WHEN a user completes each journey: find and read, sign in, upload, check uploads, remove or opt out, report, moderate
- THEN every journey can be completed

### Scripts only enhance
- GIVEN JavaScript is on
- WHEN pages load
- THEN scripts only add upload progress, reader settings without reload, saving reading position and in-place upload status

### WCAG 2.2 AA
- GIVEN every page in the inventory
- WHEN it is checked against WCAG 2.2 AA
- THEN it passes

### Skip link, landmarks and one h1
- GIVEN any page
- WHEN it renders
- THEN it has a skip link, landmarks and exactly one `<h1>`
- AND heading order matches the visual order

### No sideways scrolling at 360 px
- GIVEN a 360 px wide viewport
- WHEN each page renders, including a work card with 20+ tags and long warnings
- THEN nothing scrolls sideways

### Every action reachable by keyboard
- GIVEN a keyboard-only user
- WHEN they navigate any page
- THEN every link, form control and action can be reached and used

### Focus rings always visible
- GIVEN a keyboard-only user moving focus
- WHEN any element receives focus
- THEN a focus ring in the accent colour is visible

### Pages make sense with CSS off
- GIVEN CSS is off
- WHEN any page renders
- THEN its HTML order is the reading order and the content makes sense

### Colour is never the only signal
- GIVEN ratings and warnings on cards and work pages
- WHEN they render
- THEN they have no colour coding and are bold text with labels spelled out

### Tag types are announced without colour
- GIVEN a tag list
- WHEN a screen reader reads it
- THEN each tag's type is given by a visually hidden label

### No web fonts
- GIVEN any page
- WHEN it loads
- THEN only system font stacks are used and no font file is downloaded

### Warnings screen needs no focus trap
- GIVEN the warnings screen
- WHEN a keyboard user reaches it
- THEN it is a full page, not a modal, and focus moves normally

### Reduced motion respected
- GIVEN `prefers-reduced-motion` is set
- WHEN the reader navigates within a page
- THEN no smooth scrolling happens

### Interface type and rhythm
- GIVEN any interface page
- WHEN it renders
- THEN interface text uses a 16 px base with line height 1.45, and the reader uses line height 1.6 at `66ch`
