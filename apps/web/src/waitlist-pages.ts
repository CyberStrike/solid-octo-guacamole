// The wait list's pages (ARCHITECTURE, Wait list), the only ones with web fonts.
// They go through the shared layout, with the wait list stylesheet after the site's.
// The other wait list pages (WL2, WL3) reuse waitlistPage.
//
// Draft copy, written from specs/scenarios/mvp/22-waitlist.md for the operator to proof.

import { escapeHtml, layout, TURNSTILE_API } from "./pages";

// Served from public/ by assetRoute. The names carry each file's content hash.
const WAITLIST_STYLESHEET_PATH = "/assets/waitlist/waitlist.81645bab20ed0f3f.css";
const FRAUNCES_LICENCE = "/assets/waitlist/fonts/fraunces/OFL.txt";
const PLEX_LICENCE = "/assets/waitlist/fonts/ibm-plex-mono/license.txt";

/**
 * A whole wait list page: the shared layout, set in the wait list's web fonts, with
 * their licences linked. Put a wait list form in a .waitlist form for its styles. The
 * layout escapes the title; the body and head are trusted markup, never escaped:
 * escape any value first.
 */
export const waitlistPage = (title: string, body: string, head = "") =>
  layout(
    title,
    `${body}
<p class="note">Set in Fraunces (<a href="${FRAUNCES_LICENCE}">licence</a>) and IBM Plex Mono (<a href="${PLEX_LICENCE}">licence</a>).</p>`,
    `<link rel="stylesheet" href="${WAITLIST_STYLESHEET_PATH}">${head}`,
  );

/**
 * The coming-soon page at / while PRELAUNCH is on, with the wait list form. Its button
 * starts disabled and only Turnstile's callbacks enable it, so without JavaScript (and
 * so without a token) the form can't be submitted at all, not even with Enter.
 */
export const comingSoonPage = (nonce: string, siteKey: string) => {
  const n = escapeHtml(nonce);
  return waitlistPage(
    "rarepair is coming soon",
    `<p>A temporary, community-run reading archive for fanworks. Upload the epub files you downloaded, and anyone can browse, search and read them in the browser.</p>
<form class="waitlist" method="post" action="/waitlist">
<label for="email">Email address</label>
<input id="email" name="email" type="email" autocomplete="email" maxlength="254" required>
<div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-callback="waitlistReady" data-expired-callback="waitlistExpired"></div>
<button id="join" type="submit" disabled>Join the wait list</button>
</form>
<noscript><p>Joining the wait list needs JavaScript, for its anti-spam check.</p></noscript>
<p class="note">Your address gets one email when the archive opens, and nothing else.</p>`,
    `<script nonce="${n}">
function waitlistReady() { document.getElementById("join").disabled = false; }
function waitlistExpired() { document.getElementById("join").disabled = true; }
</script>
<script src="${TURNSTILE_API}" nonce="${n}" async defer></script>`,
  );
};
