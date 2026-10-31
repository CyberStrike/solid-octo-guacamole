// The shared layout every app page goes through, and the pages built on it:
// the Turnstile placeholders (A1, U3 and X1 replace them), the not-found page
// and the static about, terms and privacy pages.

import { TURNSTILE_ORIGIN } from "./security";
import { STYLESHEET_PATH } from "./styles";

const TURNSTILE_API = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js`;

/** Text made safe to put in an HTML element or attribute. */
const escapeHtml = (text: string) =>
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
<p class="banner">rarepair is an unofficial, temporary stopgap. <a href="/about">About this site</a></p>
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
<p>People upload the epub files they downloaded from the original archive while it is offline. Anyone can browse, search and read the uploaded works here. Every work links back to its original page, and the credit belongs to its author.</p>
<p>Uploads are public and readable by everyone. Anyone can ask for a work to be removed, with no need to prove who they are, using the "Remove my work" link in the footer.</p>`,
  );

export const termsPage = () =>
  layout(
    "Terms",
    `${DRAFT}
<p>By creating an account you agree to these terms.</p>
<ul>
<li>You may upload only epub files exported from the original archive, and only works you are happy to have shared.</li>
<li>Every upload is public: anyone can read it.</li>
<li>Anyone can ask for a work to be removed, and we act on removal requests quickly, without asking for proof of identity.</li>
<li>We may hide or remove any work, and close any account, to keep the site safe.</li>
<li>This site is an unofficial, temporary stopgap with no guarantees: it may change or close at any time.</li>
</ul>`,
  );

export const privacyPage = () =>
  layout(
    "Privacy",
    `${DRAFT}
<p>We keep as little about you as we can.</p>
<ul>
<li>Signing in uses an email link. We keep your email address and no password.</li>
<li>Uploads are public. We do not publish your email address.</li>
<li>The wait list: before launch, if you join it, we keep your email address to send you one launch email, and delete the list after that email goes out.</li>
<li>We store the settings and reading position you save, to bring them back next time.</li>
<li>Our anti-spam check, provided by Cloudflare, runs on the sign-in, upload and removal pages.</li>
</ul>`,
  );
