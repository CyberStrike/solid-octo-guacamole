// Minimal pages until the shared layout (S1) and the real sign-in, upload and
// removal pages (A1, U3, X1) replace them. They exist so the Turnstile pages'
// policy and nonced challenge script can be served and tested.

import { TURNSTILE_ORIGIN } from "./security";
import { LINK_LIFETIME_MINUTES } from "./signin";

const TURNSTILE_API = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js`;

/** A whole HTML document. Every argument is trusted markup from this file, never escaped. */
const page = (title: string, body: string, head = "") => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · rarepair</title>${head}</head>
<body><main>${body}</main></body>
</html>`;

/** A page with a Turnstile check: the challenge script carries the page nonce. */
export const turnstilePage = (title: string, nonce: string) =>
  page(
    title,
    `<h1>${title}</h1>
<noscript><p>This page needs JavaScript for its anti-spam check. Reading works without it.</p></noscript>`,
    `<script src="${TURNSTILE_API}" nonce="${nonce}" async defer></script>`,
  );

export const notFoundPage = () =>
  page("Not found", `<h1>Page not found</h1><p><a href="/">Back to rarepair</a></p>`);

/** Escapes text for an HTML text node or a double-quoted attribute value. */
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export interface SignInForm {
  /** The Turnstile widget's site key. */
  siteKey: string;
  /** Where to go after signing in, already reduced to a same-site path. */
  next: string;
  /** What the visitor typed, when the form comes back to them. */
  email?: string;
  /** Why the form came back. */
  error?: string;
}

/**
 * The sign-in form, with Turnstile alongside. The form starts `hidden` and a
 * nonced script shows it, so without JavaScript there is only the `<noscript>`
 * message and nothing to submit: the request could never pass Turnstile anyway.
 */
export const signInPage = (nonce: string, form: SignInForm) =>
  page(
    "Sign in",
    `<h1>Sign in</h1>
${form.error === undefined ? "" : `<p role="alert">${escapeHtml(form.error)}</p>`}
<noscript><p>Signing in needs JavaScript, for its anti-spam check. Reading works without it.</p></noscript>
<form id="sign-in" method="post" action="/login" hidden>
<label for="email">Email address</label>
<input id="email" type="email" name="email" autocomplete="email" required value="${escapeHtml(form.email ?? "")}">
<input type="hidden" name="next" value="${escapeHtml(form.next)}">
<div class="cf-turnstile" data-sitekey="${escapeHtml(form.siteKey)}"></div>
<button type="submit">Email me a sign-in link</button>
</form>
<script nonce="${nonce}">document.getElementById("sign-in").hidden = false;</script>
<p>We'll email you a link that signs you in. It can take a minute to arrive during busy periods.</p>`,
    `<script src="${TURNSTILE_API}" nonce="${nonce}" async defer></script>`,
  );

/** After a sign-in request: what happens next. */
export const checkEmailPage = () =>
  page(
    "Check your email",
    `<h1>Check your email</h1>
<p>We've sent you a sign-in link. It lasts ${LINK_LIFETIME_MINUTES} minutes.</p>
<p>The link can take a minute to arrive during busy periods.</p>`,
  );

/** A form posted from somewhere other than this site. */
export const forbiddenPage = () =>
  page(
    "Request refused",
    `<h1>Request refused</h1><p>That request didn't come from rarepair. <a href="/login">Sign in here</a>.</p>`,
  );
