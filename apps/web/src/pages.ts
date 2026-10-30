// Minimal pages until the shared layout (S1) and the real sign-in, upload and
// removal pages (A1, U3, X1) replace them. They exist so the Turnstile pages'
// policy and nonced challenge script can be served and tested.

const TURNSTILE_API = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** A whole HTML document. `title` and `body` are trusted markup from this file. */
export const page = (title: string, body: string, head = "") => `<!doctype html>
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
