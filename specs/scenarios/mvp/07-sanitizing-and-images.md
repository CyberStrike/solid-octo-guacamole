# Scenario: Sanitizing chapter HTML, summaries, notes and images

Relates to: docs/ARCHITECTURE.md § Sanitizing (security requirement), § EPUB processor (step 6), § Reading (What's left without an iframe; We can re-sanitize everything), § Testing

## Setup
- The sanitizer uses Workers' native `HTMLRewriter` only as a tokenizer, to build a small tree with a depth cap and a node budget
- The output is written from scratch by an allowlist serializer that emits only allowlisted elements and attributes and escapes all text and attribute values; nothing from the input reaches the output except through it
- Hand-built fixtures with XSS payloads in every field (chapter bodies, summary, notes, end notes, titles, tags)
- A known XSS corpus is available for fuzzing
- Image fixtures: valid PNG, JPEG, GIF and WebP; a file named `.png` that is actually HTML; an image of exactly 5 MB and one just over; an SVG; a font; a stylesheet

## Cases

### Allowlisted elements are kept
- GIVEN a chapter containing `p, br, hr, em, strong, i, b, u, s, sub, sup, blockquote, h1–h6, ul, ol, li, dl, dt, dd, table, thead, tbody, tr, th, td, span, div, a, img, abbr, small, center`
- WHEN it is sanitized
- THEN all of those elements remain

### Only allowlisted attributes are kept
- GIVEN an allowed element with `href`, `src`, `alt`, `title`, `colspan`, `rowspan`, `dir`, `lang`, `align` and also `class`, `id` and `data-x`
- WHEN it is sanitized
- THEN only `href`, `src`, `alt`, `title`, `colspan`, `rowspan`, `dir`, `lang` and `align` remain
- AND `class`, `id` and `data-x` are removed

### Dangerous elements are dropped
- GIVEN a chapter containing `script`, `style`, `iframe`, `object`, `embed`, `form`, `svg` and `math` elements, each with text or child elements inside
- WHEN it is sanitized
- THEN none of those elements remain in the output
- AND nothing that was inside them remains either

### Dangerous elements under a namespace prefix are dropped
- GIVEN a chapter containing `<svg:script>alert(1)</svg:script>` and `<html:style>p { display: none }</html:style>`
- WHEN it is sanitized
- THEN neither element remains in the output
- AND neither element's contents remain either

### Event handler attributes are dropped
- GIVEN an allowed element with `onclick`, `onerror`, `onload` and other `on*` attributes
- WHEN it is sanitized
- THEN no `on*` attribute remains

### Inline style is dropped
- GIVEN an allowed element with a `style` attribute
- WHEN it is sanitized
- THEN the `style` attribute is removed

### Unknown wrapper elements are unwrapped
- GIVEN text inside an unknown wrapper element such as `<custom-box>`
- WHEN it is sanitized
- THEN the wrapper is removed and its text survives

### http and https links are kept with rel attributes
- GIVEN a link to `https://example.org/`
- WHEN it is sanitized
- THEN the `href` is kept
- AND the link has `rel="nofollow noopener noreferrer ugc"`

### Links to another chapter of the same work are rewritten
- GIVEN a link from chapter 1 to an anchor in chapter 3 of the same epub
- WHEN it is sanitized
- THEN the `href` is rewritten to our own reader URL for that chapter

### Other link schemes are removed
- GIVEN links with `javascript:`, `data:`, `vbscript:` and `mailto:` hrefs
- WHEN they are sanitized
- THEN none of those `href` values remain

### Images inside the epub are rewritten to the content origin
- GIVEN an `img` whose `src` points to an image in the epub manifest
- WHEN it is sanitized
- THEN the `src` is rewritten to the image's R2 key on `content.<domain>`

### Remote images are dropped
- GIVEN an `img` whose `src` is a remote URL
- WHEN it is sanitized
- THEN the image is dropped

### Summary and notes are sanitized too
- GIVEN XSS payloads in the summary, notes and end notes
- WHEN the work is ingested
- THEN the same allowlist is applied to each of them

### Image types are checked by file signature
- GIVEN manifest images that are PNG, JPEG, GIF and WebP by their file signature
- WHEN the work is ingested
- THEN each is stored under `works/<ao3_work_id>/img/` keyed by its SHA-256

### Image with a misleading extension is rejected
- GIVEN a manifest entry named `cover.png` whose bytes are HTML
- WHEN the work is ingested
- THEN the file is not stored as an image

### Image of exactly 5 MB is accepted
- GIVEN a valid PNG of exactly 5 MB
- WHEN the work is ingested
- THEN it is stored

### Image over 5 MB is not stored
- GIVEN a valid PNG just over 5 MB
- WHEN the work is ingested
- THEN it is not stored

### SVG, fonts and stylesheets are dropped
- GIVEN an epub containing an SVG image, an embedded font and a stylesheet
- WHEN the work is ingested
- THEN none of them are stored or referenced in the output
- AND AO3 work skins are not carried over

### Identical images in one work share one key
- GIVEN two images with identical bytes in one work
- WHEN the work is ingested
- THEN they share one SHA-256 key under `works/<ao3_work_id>/img/`

### Lookalike interface markup is neutralized
- GIVEN chapter markup crafted to look like a "log in again" box using `<form>`, `<style>` and inline `style`
- WHEN it is sanitized
- THEN the form, style element and inline styles are all removed

### Fuzzing with an XSS corpus finds no bypass
- GIVEN the known XSS corpus
- WHEN each payload is sanitized and rendered
- THEN no payload produces a script element, event handler, inline style or disallowed URL scheme

### Sanitizer fixes can be backfilled
- GIVEN works ingested before a sanitizer fix
- WHEN every stored work is re-run from `originals/` through the backfill queue
- THEN each work's chapters are re-sanitized with the fixed sanitizer
