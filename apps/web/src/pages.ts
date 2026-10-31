// The shared layout every app page goes through, and the pages built on it:
// the Turnstile placeholders (A1, U3 and X1 replace them), the not-found page
// and the static about, terms and privacy pages.

import { TURNSTILE_ORIGIN } from "./security";
import { STYLESHEET_PATH } from "./styles";

export const TURNSTILE_API = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js`;

/** Text made safe to put in an HTML element or attribute. */
export const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * A whole HTML document: skip link, temporary banner, header, one chrome h1 made
 * from the title, the body inside main, then the footer. The title is escaped.
 * The body and head are trusted markup from this file, never escaped; put no
 * user text in them without escaping it first.
 */
export const layout = (title: string, body: string, head = "") => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · rarepair</title><link rel="stylesheet" href="${STYLESHEET_PATH}">${head}</head>
<body>
<a class="skip" href="#main">Skip to the main content</a>
<aside class="banner" aria-label="Notice">rarepair is an unofficial, temporary stopgap. <a href="/about">About this site</a></aside>
<header><a class="site-name" href="/">rarepair</a></header>
<main id="main">
<h1>${escapeHtml(title)}</h1>
${body}
</main>
<footer><a href="/remove">Remove my work</a> · <a href="/about">About</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></footer>
</body>
</html>`;

/** A page with a Turnstile check: the challenge script carries the page nonce. */
export const turnstilePage = (title: string, nonce: string) =>
  layout(
    title,
    `<noscript><p>This page needs JavaScript for its anti-spam check. Reading works without it.</p></noscript>`,
    `<script src="${TURNSTILE_API}" nonce="${escapeHtml(nonce)}" async defer></script>`,
  );

export const notFoundPage = () =>
  layout(
    "Page not found",
    `<p>That page does not exist. Try a search, or go back to <a href="/">the home page</a>.</p>
<form role="search" method="get" action="/search">
<label for="q">Search the archive</label>
<input type="search" id="q" name="q">
<button type="submit">Search</button>
</form>`,
  );

const DRAFT = `<p class="draft">Draft: this text has not been proofread yet.</p>`;

// Drafts for the operator to proof before launch. They describe provenance
// without naming the original archive or its organisation (branding rule).
export const aboutPage = () =>
  layout(
    "About rarepair",
    `${DRAFT}
<p>rarepair is a temporary, community-run reading archive for fanworks. It is an unofficial stopgap, not the original archive, and it is not affiliated with or approved by that archive or the organisation behind it.</p>
<p>People upload the epub files they downloaded from the original archive while it is offline. Anyone can browse and read the works that have been uploaded and accepted. Work pages link back to the original page, and the credit belongs to its author.</p>
<p>Accepted uploads are public. Anyone can ask for a work to be removed, with no need to prove who they are, using the "Remove my work" link in the footer.</p>`,
  );

export const termsPage = () =>
  layout(
    "Terms",
    `${DRAFT}
<p>By creating an account you agree to these terms.</p>
<ul>
<li>You may upload only epub files exported from the original archive, and only works you are happy to have shared.</li>
<li>Uploads that pass our checks are public: anyone can read them.</li>
<li>Anyone can ask for a work to be removed, without proving who they are.</li>
<li>We may hide or remove any work, and close any account, to keep the site safe.</li>
<li>This site is an unofficial, temporary stopgap with no guarantees: it may change or close at any time.</li>
</ul>`,
  );

export const privacyPage = () =>
  layout(
    "Privacy",
    `${DRAFT}
<p>This is what we keep about you.</p>
<ul>
<li>Signing in uses an email link. We keep your email address and no password.</li>
<li>Accepted uploads are public. We do not publish your email address.</li>
<li>Removal and opt-out requests keep a hashed form of the requester's network address, to limit abuse.</li>
<li>The wait list: before launch, if you join it, we keep your email address to send you one launch email. We delete your address once the launch emails have been sent, or sooner if you unsubscribe.</li>
<li>We store the settings and reading position you save, to bring them back next time.</li>
<li>Our anti-spam check, provided by Cloudflare, runs on the sign-in, upload and removal pages.</li>
</ul>`,
  );
