// The site stylesheet, served by the Worker from a string so it needs no
// wrangler.jsonc change. System fonts only (FRONTEND-DISCOVERY, Typographic
// system): the wait list's web fonts belong to its own pages, not here.

export const STYLESHEET = `:root {
  color-scheme: light dark;
  --space: 4px;
  --text-1: 13px;
  --text-2: 16px;
  --text-3: 20px;
  --text-4: 25px;
  --text-5: 31px;
  --text-6: 39px;
  --ink: #1a1a1a;
  --paper: #fafaf7;
  --muted: #5c5c57;
  --rule: #d8d8d2;
  --accent: #0b5cad;
  --ui: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --reading: Charter, "Bitstream Charter", "Iowan Old Style", Georgia, serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e8e8e3;
    --paper: #151515;
    --muted: #a3a39d;
    --rule: #3a3a36;
    --accent: #7ab4f0;
  }
}

html {
  font-size: 16px;
}

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--ui);
  font-size: var(--text-2);
  line-height: 1.45;
}

a {
  color: var(--accent);
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.skip {
  position: absolute;
  left: calc(var(--space) * 2);
  top: calc(var(--space) * -12);
  padding: calc(var(--space) * 2) calc(var(--space) * 3);
  background: var(--paper);
}

.skip:focus {
  top: calc(var(--space) * 2);
}

.banner {
  margin: 0;
  padding: calc(var(--space) * 2) calc(var(--space) * 4);
  border-bottom: 1px solid var(--rule);
  font-size: var(--text-1);
  text-align: center;
}

header,
main,
footer {
  max-width: 66ch;
  margin: 0 auto;
  padding: 0 calc(var(--space) * 4);
}

header {
  padding-top: calc(var(--space) * 4);
  padding-bottom: calc(var(--space) * 4);
}

.site-name {
  font-size: var(--text-3);
  font-weight: 600;
  color: var(--ink);
  text-decoration: none;
}

main {
  padding-top: calc(var(--space) * 6);
  padding-bottom: calc(var(--space) * 12);
}

h1 {
  margin: 0 0 calc(var(--space) * 4);
  font-size: var(--text-5);
  line-height: 1.2;
}

h2 {
  margin: calc(var(--space) * 8) 0 calc(var(--space) * 2);
  font-size: var(--text-3);
}

.banner a,
footer a {
  display: inline-block;
  min-height: 24px;
  line-height: 24px;
}

.draft {
  color: var(--muted);
  font-size: var(--text-1);
}

form[role="search"] {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--space) * 2);
  align-items: center;
}

input[type="search"] {
  flex: 1 1 16em;
  font: inherit;
  padding: calc(var(--space) * 2);
}

button {
  font: inherit;
  padding: calc(var(--space) * 2) calc(var(--space) * 4);
}

footer {
  padding-top: calc(var(--space) * 4);
  padding-bottom: calc(var(--space) * 8);
  border-top: 1px solid var(--rule);
  font-size: var(--text-1);
}

article.chapter {
  font-family: var(--reading);
  line-height: 1.6;
  max-width: 66ch;
}

@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    scroll-behavior: auto;
    animation: none;
    transition: none;
  }
}

/* Work cards (FRONTEND-DISCOVERY, Work card): sections by whitespace and a hairline. */
.work-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.work-card {
  padding: calc(var(--space) * 4) 0;
  border-bottom: 1px solid var(--rule);
}

.work-card h2 {
  margin: 0;
  font-size: var(--text-3);
}

.work-card p {
  margin: var(--space) 0;
}

/* Rating and warnings: the author's size at weight 600, never clamped or hidden. */
.card-rating {
  overflow-wrap: anywhere;
}

.card-rating strong {
  font-weight: 600;
}
`;

// FNV-1a, enough to give each version of the stylesheet its own URL.
const fnv1a = (text: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const STYLESHEET_PATH = `/assets/site.${fnv1a(STYLESHEET)}.css`;
