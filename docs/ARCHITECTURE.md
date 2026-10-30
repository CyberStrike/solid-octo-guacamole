# Architecture & MVP scope

A temporary, community-run reading archive for fanworks while AO3 is offline.
People upload the `.epub` files they downloaded from AO3, and anyone can browse,
search and read them in the browser.

**Working name:** TBD. We must not use the AO3 or OTW names, logos or site styling,
and must not imply any affiliation. Every work page links back to its original
AO3 URL and says plainly that this is an unofficial stopgap.

## Decisions so far

| Question | Decision |
| --- | --- |
| Who can read uploads | Shared public archive. Every upload is readable by everyone, with takedowns and author removal requests from day one |
| Hosting | Cloudflare: Workers, R2, Queues, KV, plus Neon Postgres through Hyperdrive |
| Load target | Surge-ready: assume tens of thousands of signups in the first days |
| Sign-in | Email magic link with no passwords stored, through Better Auth (self-hosted in the Worker, data in Neon) and Resend |
| Accepted files | AO3-native epub exports only. FanFicFare support comes later |
| New versions | Replace the current version automatically only if newer and consistent with it. Otherwise hold for review |
| Author identity | No work claims and no author verification while AO3 is down. Removal and opt-out are requests anyone can make, without proving who they are |
| Search scope | Metadata only: title, author, tags, summary |
| Chapter rendering | Inline in app pages behind a strict CSP, with no iframe |

## System overview

```
                 ┌───────────────────────── app.<domain> ─────────────────────────┐
 Browser ──────▶ │  web Worker (Hono, server-rendered HTML)                         │
   │             │   • browse / search / work + chapter reader / auth / uploads    │
   │             │   • Turnstile + rate limits on signup, login, upload            │
   │             └──────┬──────────────┬──────────────────┬───────────────────────┘
   │                    │ Hyperdrive   │ KV               │ Queue: ingest
   │                    ▼              ▼                  ▼
   │              Neon Postgres    caches,           ingest Worker (consumer)
   │              (metadata, FTS,  reading pos.,      • unzip, parse OPF + AO3 preface
   │               users, auth)    rate counters      • sanitize chapter XHTML
   │                    ▲                             • write chapters to R2, rows to PG
   │                    └─────────────────────────────┘
   │  upload: presigned PUT from the browser (needs JS, like every Turnstile form)
   ├────────────────────────────────────────────────▶ R2: uploads/  (raw epubs)
   │
   │             ┌──────────────────────── content.<domain> ──────────────────────┐
   └──────────▶  │  content Worker: epub images + original-file downloads from R2   │
                 │  separate origin, no cookies, nosniff, edge-cached forever      │
                 └──────────────────────────────────────────────────────────────────┘
```

### Why these pieces

- **R2 for all bytes.** It has no egress fees, which matters most when the
  workload is mostly serving books. Fresh uploads land in `uploads/`, which
  expires on its own. Original files we keep go in `originals/`, and processed
  chapters go under `works/<ao3_work_id>/<upload_id>/`: one prefix per version,
  keyed by the upload that produced it, so a retried job overwrites only its own
  files. `work_versions.r2_prefix` records it; version numbers live only in
  Postgres. The AO3 work ID is known once the preface is parsed, before anything
  is written.
- **Neon Postgres over D1.** D1 is capped at 10 GB per database, the cap can't
  be raised, and each database runs one query at a time. AO3 has more than 15M
  works. Even metadata-only rows (title, summary, tags) for a large share of
  them would pass 10 GB, and sharding search across D1 databases is work we
  don't need. Postgres also gives us `tsvector` full-text search and `pg_trgm`
  fuzzy matching. Chapter text lives in R2, not in the database.
- **Queues for ingestion.** Parsing happens off the request path, so a flood of
  uploads becomes a backlog, not an outage. Queue consumers get up to 15 minutes
  of CPU per invocation and 128 MB of memory, which is plenty for an epub capped
  at 25 MB.
- **Two layers of XSS defense, with no iframe.** Epubs are zip files of arbitrary
  HTML. The sanitized chapter HTML is rendered straight into app pages. The
  second layer is a strict, nonce-based CSP on every app page, so a script that
  gets past the sanitizer still can't run (see Reading). The separate
  `content.<domain>` origin, which sets no cookies, is kept only for the bytes
  we serve as they are: images from inside epubs and original-file downloads.

## Data model (first cut)

```sql
user         (id, email, name, email_verified, image, created_at, updated_at,  -- Better Auth's table
              role, upload_quota_used, banned_at)                             -- plus our fields
session, account, verification  -- Better Auth's tables; verification holds hashed magic-link tokens
works        (id, ao3_work_id UNIQUE NULL, title, summary_html, rating, language,
              words, chapters_count, complete, published_at, updated_at,
              status,            -- processing | live | held | hidden | removed
              current_version_id, raw_meta jsonb, search tsvector)
work_authors (work_id, pseud, ao3_user NULL)
work_versions(id, work_id, upload_id, chapter_count, r2_prefix, created_at)
chapters     (work_id, version_id, n, title, words, r2_key)
tags         (id, type, name, name_norm) -- type: fandom|relationship|character|freeform|warning|category|rating
work_tags    (work_id, tag_id)
uploads      (id, user_id, r2_key, sha256, bytes, status, lease_until,
              error_stage, error, work_id NULL, created_at)
reports      (id, work_id, reporter_id, kind, body, status, created_at)  -- reporting needs an account
takedowns    (id, work_id, requester, basis, status, resolved_by, created_at)
requests     (id, kind, work_id NULL, pseud_norm NULL, contact_email, statement,
              status, ip_hash, created_at)        -- kind: remove_work | opt_out
optouts      (id, pseud_norm, ao3_user NULL, request_id, active, created_at)  -- checked at ingest
```

**Dedupe.** AO3 epubs carry the original work URL
(`archiveofourown.org/works/<id>`) in the preface. That ID is the canonical key.
Later uploads of the same work go through the versioning rules in the EPUB
processor section. Files without an AO3 ID are rejected in v1. Exact
re-uploads are caught early by the file's SHA-256.

**Tags.** AO3's tag wrangling (canonical tags and synonyms) can't be rebuilt in
a week. Store tags exactly as written, plus a normalized form (`name_norm`:
lowercased, whitespace and punctuation folded) used for matching. Moderators can
merge synonyms later.

## Ingestion pipeline

1. **Ask.** `POST /uploads` checks the session, Turnstile, the daily quota and
   the declared size (25 MB or less). It inserts an `uploads` row and returns a
   presigned R2 `PUT` URL, valid for 10 minutes and locked to
   `Content-Type: application/epub+zip`. R2 presigned URLs support PUT but not
   form POST, and the bucket needs a CORS rule for `app.<domain>`.
2. **Upload.** The browser PUTs the file straight to R2 and shows progress.
   Uploading needs JavaScript, as every form with a Turnstile check does
   (Turnstile can't produce a token without it); without JS the upload page
   says so (FRONTEND-DISCOVERY, *Where the frontend changes the architecture*).
3. **Confirm.** `POST /uploads/:id/complete` HEADs the object, checks its size,
   and enqueues `{upload_id}`.
4. **Process.** The ingest consumer runs with a batch size of about 5, retries,
   and a dead-letter queue. See the EPUB processor section below.
5. **Track.** The uploader's page polls `GET /uploads/:id` for its status:
   `processing`, `live`, `held_for_review`, `duplicate`, or one of the
   rejection codes below. `held_for_review` and `duplicate` are not
   rejections: the upload is kept, it just isn't (yet) the current version.

### EPUB processor

It lives in `packages/epub`. Its functions are pure: bytes in, a parsed work
out. `apps/ingest` is a thin wrapper that handles R2, Postgres and job status.

**Scope for v1.** Only AO3-native exports are accepted. Non-AO3 epubs are
rejected (`not_ao3`), which keeps commercial ebooks out and gives every work a
link back to AO3. FanFicFare files of AO3 works come later, through a second
preface parser. Search covers metadata only: title, author, tags and summary.
Chapter text isn't indexed.

1. **Lease the job.** Queues may deliver a message more than once, so the job starts
   with an atomic `UPDATE uploads SET status='processing', lease_until=…` that
   only matches when the upload is `pending` or its lease has expired. All
   output goes under `works/<ao3_work_id>/<upload_id>/`, so a retry overwrites
   its own files and never touches another run's.
2. **Unzip with limits.** Read the object from R2 (25 MB or less) and check
   the zip's file index before decompressing anything:
   - at most 2,000 entries
   - at most 100 MB uncompressed in total
   - at most 20 MB per entry

   Count bytes during decompression as well, because a zip can lie about its
   sizes. Reject entry names with `..`, a leading `/` or a drive letter. The
   `mimetype` entry must be `application/epub+zip`. Breaking any of these
   rules gives `not_epub` or `zip_bomb`. Unzip with `fflate`.
3. **Index files.** `META-INF/container.xml` points to the OPF, which gives the
   metadata, the file list, the reading order and the table of contents (NCX
   or EPUB3 nav). Workers have no `DOMParser`, so XML is parsed with
   `fast-xml-parser`. XHTML goes through `HTMLRewriter`.
4. **AO3 preface.**
   - **Provenance:** look for the work URL
     (`archiveofourown.org/works/<id>`) in the preface's "Posted originally on
     the Archive of Our Own" line, or in the OPF identifier or source. If it's
     missing, the file is rejected with `not_ao3`.
   - **Fields are matched by label text, never by CSS class.** AO3 builds
     epubs with Calibre, which may rename classes. Read the `dt`/`dd` pairs
     under labels such as `Rating:`, `Archive Warning:`, `Category:`,
     `Fandom:`, `Relationship:`, `Character:`, `Additional Tags:`,
     `Language:`, `Series:` and `Stats:`. Summary, notes and end notes come
     from their headed blocks.
   - Unknown labels are kept in a `raw_meta` JSON column, so we never lose
     data the parser doesn't understand yet.
   - Then check the opt-out and takedown lists. A match rejects the file with
     `opted_out`.
5. **Chapter boundaries.** Files in the reading order are not chapters.
   Calibre splits documents by size (`*_split_NNN.xhtml`), so one chapter can
   span several files and one file can hold several chapters. Ways to find the
   real boundaries, in order of preference:
   1. Table-of-contents entries (`file.xhtml#anchor`). Stream the files in
      order and start a new chapter buffer when the anchor's element appears.
   2. AO3 chapter headings, if the table of contents is missing or doesn't
      match.
   3. One chapter per file, as a last resort. The work is then flagged for
      review.

   The parsed chapter count must match the count in the preface `Stats:`. If it
   doesn't, the work is flagged for review instead of going live.
6. **Sanitize.** Apply the allowlist below to chapter bodies, the summary and
   the notes. Images listed in the manifest are checked by their file signature
   (PNG, JPEG, GIF or WebP only), capped at 5 MB each, stored by SHA-256 under
   `works/<ao3_work_id>/img/`, and their links rewritten. SVG, fonts and
   stylesheets are dropped. Images deliberately sit outside the per-upload
   prefix: keyed by content hash, they are shared by every version that uses
   them, a retried job rewrites the same keys, and they can be cached as
   `immutable`. Images no version references (say, from a job that failed
   before its transaction) are removed by a periodic sweep, and all of them go
   when the work is removed.
7. **Versioning.** Each work is keyed by `ao3_work_id`. The first upload
   creates the work. A later upload:
   - **replaces the current version** only if it is newer (more chapters or a
     later Updated/Completed date) **and** the chapters both versions share
     come out as near-identical text after sanitizing. Small edits are allowed;
     compare a hash of the normalized text per chapter plus a similarity
     threshold.
   - **is held for review** (`held_for_review`) if it is newer but its shared
     chapters differ, or if its tags or authors changed. This blocks someone
     editing an epub to tamper with a work.
   - **is marked `duplicate`** if it isn't newer. It's stored but not used.
     This is a status, not a rejection: the uploader is told the work is
     already in the archive.

   Nobody's upload gets special treatment, the author's included. We can't
   tell who the author is while AO3 is down.

   Every version is kept, so a bad replacement can be rolled back.
8. **Save, in order.** Write chapter fragments and images to R2. Then run one
   Postgres transaction that upserts the work, adds the version, chapters and
   tags, and points `current_version_id` at the new version. Set the work
   `live` last. If the job fails before the transaction, R2 is left with
   orphaned files under its `<upload_id>/` prefix, which the cleanup rules
   delete. A
   job that fails for good goes to the dead-letter queue as `parse_failed`,
   with the stage and error recorded on the upload row.

**Rejection codes:** `not_epub`, `zip_bomb`, `too_large`, `not_ao3`,
`opted_out`, `parse_failed`. Each one shows a plain-language message to the
uploader. (`held_for_review` and `duplicate` are statuses, not rejections.)

**Testing.** `HTMLRewriter` exists only in the Workers runtime, so the
`packages/epub` tests run under `@cloudflare/vitest-pool-workers`. Fixtures are
about 50 real AO3 epubs covering:
- older and current AO3 export formats
- one-shots and works with many chapters
- works with images and work skins
- anonymous works and series members
- non-English and right-to-left text

There are also hand-built bad files: zip bombs, path traversal, a missing OPF,
a chapter count that doesn't match `Stats:`, and XSS payloads in every field.
The parser must give the same output whenever it runs, so a fixture's output
can be snapshotted.

### Sanitizing (security requirement)

- Allowlist only: `p, br, hr, em, strong, i, b, u, s, sub, sup, blockquote, h1–h6,
  ul, ol, li, dl, dt, dd, table, thead, tbody, tr, th, td, span, div, a, img, abbr,
  small, center` and a short list of attributes (`href`, `src`, `alt`, `title`,
  `colspan`, `rowspan`, `dir`, `lang`, `align`). `class` and `id` are dropped:
  Calibre's class names mean nothing to our styles, and ids could clash with
  the page's own.
- Drop `script`, `style`, `iframe`, `object`, `embed`, `form`, `svg`, `math`
  (also under a namespace prefix such as `svg:script`), together with
  everything inside them, plus every `on*` attribute and inline `style`. AO3
  work skins are lost, which is an acceptable trade-off.
- `href` may only be `http(s)://` or a link to another chapter of the same work,
  rewritten to our own reader URL. External links get
  `rel="nofollow noopener noreferrer ugc"`, so following one doesn't tell the
  target which work a reader was on.
- `img src` must point to an image inside the epub, rewritten to its R2 key on
  `content.<domain>`. Remote images are dropped, which also stops them being
  used to track readers.
- Implementation (`packages/epub`): `HTMLRewriter` is used only as a
  tokenizer, to build a small tree with a depth cap and a node budget. The
  output is then written from scratch by a serializer that emits only
  allowlisted elements and attributes, escaping all text and attribute values.
  Nothing from the input reaches the output except through that serializer, so
  the serializer is the security boundary. Dropped elements are left out with
  their contents; unknown wrapper elements are unwrapped so their text
  survives. It is tested against an XSS corpus in chapters, the summary and the
  notes; fuzz it further before launch.

## Reading

- The reader page is server-rendered on the app: `/works/:id/chapters/:n`. The
  web Worker reads the sanitized chapter fragment from R2 through its binding
  and renders it inline in the page, inside `<article class="chapter">`. There
  is no iframe and no client-side epub engine, so Ctrl+F, printing, text
  selection, screen readers, translation tools and reader extensions all work
  normally. Pages also stay fast on cheap phones.
- **Strict CSP on every app page** (a fresh nonce per response):
  `default-src 'self'; script-src 'nonce-{n}' 'strict-dynamic'; style-src 'self';
  img-src 'self' https://content.<domain>; object-src 'none'; base-uri 'none';
  form-action 'self'; frame-ancestors 'none'`. Injected markup can't guess the
  nonce, so any script that gets past the sanitizer won't run. Session cookies
  are `HttpOnly`, so scripts can't read them anyway.
- **Pages with a Turnstile check** (sign-in, upload, `/remove`) add exactly one
  allowance, `frame-src https://challenges.cloudflare.com`, for the challenge
  iframe. Turnstile's `api.js` loads through a nonced `<script>`, which
  `'strict-dynamic'` already covers. Reader and work pages never get it.
- **What's left without an iframe:** content made to look like our own
  interface, such as a fake "log in again" box or a lookalike link. The
  sanitizer already blocks the main tools for that by stripping `<form>`,
  `<style>` and inline `style`, and by limiting links. The reader CSS also sets
  `.chapter { contain: content; }` and keeps `position` locked inside it. Treat
  any new trick here as a sanitizer bug.
- **We can re-sanitize everything.** Originals are kept in `originals/`, so
  when a bypass is found we fix the sanitizer and re-run ingest on every stored
  work from a backfill queue.
- **Caching.** Fragments in R2 never change once written, since each version
  has its own prefix. The Worker caches them with the Cache API. Reader
  settings (font, spacing, theme) come from a cookie. The server writes them as
  `data-*` attributes on `<html>`, or a script flips the attributes when they
  change, and the stylesheet's CSS variables key off those attributes. Inline
  `style` is never used, since the CSP blocks it. So the same chapter fragment
  serves every reader. Pages
  for signed-out readers can get a short edge cache, apart from the nonce: use
  a cached template with the nonce swapped in, or cache only the fragment.
- Before the first chapter of a work rated Mature or Explicit, or carrying
  archive warnings, or marked "Choose Not To Use Archive Warnings", readers see
  an interstitial with its rating and warnings. Logged-in users can turn it off.
- The reader has font size, line spacing, light/dark/sepia themes, and a
  one-page "entire work" view. These settings are stored in a cookie.
- Signed-in users get their reading position saved to KV, keyed by
  `user:work`, with a short debounce.
- "Download original epub" serves the file from `originals/` with
  `Content-Disposition: attachment` from `content.<domain>`. It's never
  displayed inline.

## Auth (magic link: Better Auth + Resend)

- **Library.** [Better Auth](https://www.better-auth.com/) 1.7 with its
  magic-link plugin, running inside the web Worker. It's open source and
  self-hosted: users and sessions live in Neon, and no third-party script
  reaches the browser, which only ever sees our own HTML forms. A spike against
  1.7.14 confirmed the behaviour below. Notes:
  - Workers needs `nodejs_compat`, because Better Auth uses `AsyncLocalStorage`.
  - Build the auth instance per request from `env` (Hyperdrive, secrets),
    because bindings only exist inside a request.
  - Pin `better-auth` and `@better-auth/kysely-adapter` to the same version.
- **Requesting a link.** `POST /login` is our own route: a plain form with
  Turnstile. Better Auth's own endpoint only accepts JSON, so our route calls
  `auth.api.signInMagicLink` on the server. Calls made that way skip Better
  Auth's CSRF check, its redirect check and its rate limiter, so our route does
  all three:
  - it checks `Origin` / `Sec-Fetch-Site`
  - it rate limits per IP and per email with the Workers rate-limiting binding
  - it reduces `next` to a same-site path (root-relative only: no `//`, no
    `\`, no control characters) before passing it on
  Tokens last 15 minutes and are stored hashed (`storeToken: "hashed"`) in
  Better Auth's `verification` table.
- **Using the link.** The email links to our `GET /login/confirm?token=…`,
  which only shows a "Sign in" button: a POST form that uses nothing up. Mail
  scanners that open links in advance therefore can't burn it.
  `POST /login/confirm` calls `auth.api.magicLinkVerify`, which redirects to
  `next` with the session cookie. A used or expired link comes back to `/login`
  with a plain message.
- **Single use.** The token is consumed by one `DELETE … RETURNING` in
  Postgres, and only the request that gets the row back is signed in, so two
  simultaneous uses can't both succeed. This holds only while tokens live in
  the database. KV has no atomic get-and-delete, so if KV is ever added as
  Better Auth's `secondaryStorage`, set `verification.storeInDatabase: true`.
- **Session cookie.**
  `__Secure-better-auth.session_token; HttpOnly; Secure; SameSite=Lax; Path=/`,
  set with `useSecureCookies: true`. There is no `Domain`
  (`crossSubDomainCookies` stays off), so the cookie never reaches
  `content.<domain>`.
- **Better Auth's own rate limiter** only covers requests through
  `auth.handler`. Its default memory store is per isolate on Workers, so set
  `rateLimit.storage: "database"` (or a Durable Object through
  `customStorage`), with `ipAddressHeaders: ["cf-connecting-ip"]`.
- **Email: Resend primary.** Emails go through a queue to a sender behind a
  small interface. Volume isn't the risk; sending limits are.
  - The queue consumer sends with Resend's batch API, to stay under its
    per-second API limit (by default about 2 requests a second; ask for more
    before launch).
  - Mail goes from a dedicated subdomain with SPF, DKIM and DMARC, warmed up
    before launch.
  - Postmark or SES is wired in as failover from day one.
  - Cloudflare Email Sending isn't used for launch: it's in beta, and new
    accounts start on a "conservative daily quota" that a signup surge would
    hit.
  - The login page tells people that links can take a minute to arrive during
    busy periods.
- Accounts are needed only to upload, report or save reading position. Reading
  never needs an account.

## Author requests & takedowns

The archive shows people's work without asking them first, so these features
are part of the MVP, not extras.

**No claims while AO3 is down.** AO3 is the only place that could vouch for who
wrote a work, and it's offline. Rather than accept weak proof, we don't offer
work claims, author accounts or author self-service at all. Authors don't need
an account. Whoever asks gets the same thing: a work hidden or an opt-out
applied. Authors update a work the same way anyone does, by uploading a newer
epub, under the normal versioning rules.

- **Remove my work.** A public form at `/remove` asks for the work's URL here
  or its AO3 URL, a contact email and a short statement. No sign-in, but
  Turnstile is required. The work is hidden **at once** and a moderator
  reviews the request. We err on the side of the person asking.
- **Opt out.** The same form, given a pseud instead of a work. It hides every
  existing work by that pseud at once, and the opt-out list is checked again
  at ingest for new uploads. A moderator confirms it. A mistaken opt-out can be
  reversed.
- **Abuse of instant hiding.** Since nobody has to prove who they are, anyone
  can hide any work for a while. Limits: requests are rate-limited per email
  and per IP. A hidden work shows "Temporarily hidden after a removal request",
  not a 404. Moderators can see every request from the same email or IP
  together, restore in bulk, and block a requester. We accept this risk: an
  unfair hide is temporary, while ignoring a genuine author is not.
- **Removal really removes.** Setting a work to `removed`, through a takedown,
  an author request or a moderator, also deletes `works/<ao3_work_id>/` and the raw
  upload from R2, and purges the work's pages, cached fragments, images and
  download URLs from the cache. Images and downloads are cached as
  `immutable`, so without the purge parts of a removed work stay reachable.
- **DMCA.** To get safe-harbor protection under US law (17 U.S.C. §512), we need
  a designated agent registered with the US Copyright Office, a public takedown
  form, a counter-notice process and a repeat-infringer policy. Get a lawyer to
  review this before launch.
- **Reports.** Every work has a report button. Reporting needs a signed-in
  account, so each report has a reporter who can be rate limited or blocked;
  signed-out readers are sent to sign in and brought back to the form. Works
  with N or more open reports are hidden automatically until a moderator looks
  at them. (Authors asking for removal use `/remove`, which needs no account.)
- **Moderation.** A small admin area has queues for reports, takedowns and
  removal or opt-out requests, plus actions to hide, remove, restore, block a
  requester and ban an uploader.

## Surge controls

- Turnstile on signup, login, upload and `/remove` requests. Turnstile needs
  JavaScript, so those forms do too; reading, browsing and search work without
  it.
- The Workers rate-limiting binding covers abuse throttling on login, upload
  requests and search, keyed per IP and per user. It's approximate and counts
  per Cloudflare location, over 10- or 60-second windows. That's fine for
  slowing abuse, but not for hard limits.
- Upload quotas are hard limits, so they're counted in Postgres (or a Durable
  Object). Start at about 50 epubs a day per account, give brand-new accounts a
  lower limit, and raise it for trusted users.
- **Orphaned uploads.** A presigned PUT can't enforce a size limit, and a
  client may never call `/complete`. So `/complete` deletes oversized objects,
  and an R2 lifecycle rule expires anything under `uploads/` after 7 days.
  Raw files the archive keeps are copied to `originals/` during ingest.
- Queue backpressure: set a maximum consumer concurrency so Neon connections
  stay bounded. Hyperdrive pools connections, and Neon autoscales compute.
- Edge cache: images and original downloads on `content.<domain>` never change
  once written, since each version has its own prefix, so they're cached with
  `Cache-Control: public, max-age=31536000, immutable`. Chapter fragments are
  cached inside the web Worker (see Reading). Work and tag listings
  get a short cache with stale-while-revalidate.
- Observability: Workers Logs and traces are on from day one. Track queue
  depth, ingest failure rate and search p95 on a dashboard.

## MVP vs later

**MVP (ship in days)**
1. Magic-link sign-in
2. Upload: presigned PUT, then queue, then parse, sanitize and dedupe
3. Work page: metadata, tags, warnings, link to the original AO3 URL
4. Reader: chapters, reader settings, warnings interstitial, saved position,
   download original
5. Browse by fandom, tag or rating, sorted by updated date or word count
6. Search: title, author, tags, summary (Postgres FTS plus trigram)
7. Remove-my-work and opt-out requests, reports, DMCA form, minimal
   moderation queue
8. Terms, a privacy notice and a clear "unofficial, temporary" banner

**Later**
- Bookmarks, kudos and per-user reading history
- Series pages and collections
- Tag synonym merging and filtering by excluded tags
- Comments (needs much more moderation, so leave it out unless people ask)
- Bulk upload from a zip of epubs
- FanFicFare epubs of AO3 works (second preface parser, keyed on `dc:source`)
- Export and shut down: nothing changes automatically when AO3 returns (the
  AO3 links simply start working). The operator starts the wind-down by hand:
  redirect every work to its AO3 URL, then shut the site down

## Proposed repo layout

```
apps/web/          Hono Worker: pages, auth, upload handshake, search, admin
apps/content/      Worker serving epub images and original downloads from R2
apps/ingest/       Queue consumer
packages/epub/     unzip + OPF + AO3 preface parser + sanitizer (tested in workerd)
packages/db/       SQL migrations + typed queries
fixtures/epubs/    real AO3 epub samples for parser and sanitizer tests
docs/
```

TypeScript throughout. The HTML is server-rendered with Hono's JSX, with only a
little client JS for upload progress and the reader settings.

## Open questions

- **Locked works.** Some AO3 works are visible only to signed-in AO3 users.
  Can we tell from the epub that a work was locked? If we can, should we keep
  those works behind a sign-in here too? This needs checking against sample
  files.
- **Anonymous and unrevealed works.** Their prefaces show "Anonymous". We
  should keep that as it is and never try to identify the author.
- **Deleted or orphaned works.** Someone may upload a work the author deleted
  from AO3. While AO3 is down we can't check, so we rely on the opt-out list and
  remove-my-work requests.
- **Domain and name.** These depend on the working name, and have to stay clear
  of anything that suggests a link to AO3 or OTW.
- **Legal review.** Get a review of the DMCA setup and terms before public
  launch.
