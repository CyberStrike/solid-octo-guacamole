// The wait list's pages (ARCHITECTURE, Wait list), the only ones with web fonts.
// They have their own shell, apart from pages.ts, until the shared layout (S1)
// lands. The other wait list pages (WL2, WL3) reuse waitlistPage.
//
// Draft copy, written from specs/scenarios/mvp/22-waitlist.md for the operator to proof.

import { TURNSTILE_ORIGIN } from "./security";

const TURNSTILE_API = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js`;

// Served from public/ by assetRoute. The names carry each file's content hash.
const STYLESHEET = "/assets/waitlist/waitlist.18413ecf8afd6c0b.css";
const FRAUNCES_LICENCE = "/assets/waitlist/fonts/fraunces/OFL.txt";
const PLEX_LICENCE = "/assets/waitlist/fonts/ibm-plex-mono/license.txt";

/**
 * A whole wait list page, in the wait list's web fonts, with their licences linked.
 * Every argument is trusted markup from this file, never escaped.
 */
export const waitlistPage = (title: string, body: string, head = "") => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · rarepair</title><link rel="stylesheet" href="${STYLESHEET}">${head}</head>
<body><main>${body}
<footer><p>Set in Fraunces (<a href="${FRAUNCES_LICENCE}">licence</a>) and IBM Plex Mono (<a href="${PLEX_LICENCE}">licence</a>).</p></footer></main></body>
</html>`;

/**
 * The coming-soon page at / while PRELAUNCH is on, with the wait list form. Its button
 * starts disabled and only Turnstile's callbacks enable it, so without JavaScript (and
 * so without a token) the form can't be submitted at all, not even with Enter.
 */
export const comingSoonPage = (nonce: string, siteKey: string) =>
  waitlistPage(
    "Coming soon",
    `<h1>rarepair is coming soon</h1>
<p>A temporary, community-run reading archive for fanworks. Upload the epub files you downloaded, and anyone can browse, search and read them in the browser.</p>
<form method="post" action="/waitlist">
<label for="email">Email address</label>
<input id="email" name="email" type="email" autocomplete="email" required>
<div class="cf-turnstile" data-sitekey="${siteKey}" data-callback="waitlistReady" data-expired-callback="waitlistExpired"></div>
<button id="join" type="submit" disabled>Join the wait list</button>
</form>
<noscript><p>Joining the wait list needs JavaScript, for its anti-spam check.</p></noscript>
<p class="note">Your address gets one email when the archive opens, and nothing else.</p>`,
    `<script nonce="${nonce}">
function waitlistReady() { document.getElementById("join").disabled = false; }
function waitlistExpired() { document.getElementById("join").disabled = true; }
</script>
<script src="${TURNSTILE_API}" nonce="${nonce}" async defer></script>`,
  );
