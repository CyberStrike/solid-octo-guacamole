# Where these fonts come from

The wait list pages' web fonts are their publishers' own woff2 files, byte for byte:
not subset, renamed internally or otherwise modified (FRONTEND-DISCOVERY, *Decisions
so far*, Coming-soon typography). Only the file names are ours: each woff2 is named
with the first 16 hex of its SHA-256, so its path is content-hashed and can be cached
as immutable. Each family's OFL licence sits beside it, also unmodified.

`test/22-waitlist.prelaunch.test.ts` checks each served woff2 and licence file against a copy of the
SHA-256 values below: keep the two in step.

## Fraunces

Upstream: https://github.com/undercasetype/Fraunces, release `1.000` (tag commit
`0bf87f6ff449871aade3921b27a9b0a04b33dba4`), licence SIL OFL 1.1.

| File here | Upstream path | SHA-256 |
| --- | --- | --- |
| `fraunces/fraunces.25e420d8c154303e.woff2` | release asset `UnderCaseType_Fraunces_1.000.zip`, `UnderCaseType_Fraunces_1.000/Fonts - Web/Fraunces[SOFT,WONK,opsz,wght].woff2` (the upright variable font) | `25e420d8c154303e08322ea77f08997c4aade75653ef18425772ada5abacd0ce` |
| `fraunces/OFL.txt` | `OFL.txt` at tag `1.000` | `bdf4c22802eaf804f998195871c6b8938aac2ac14b2d78a8bd66a6f1eced833b` |

## IBM Plex Mono

Upstream: https://github.com/IBM/plex, release `@ibm/plex-mono@2.5.0`, licence SIL
OFL 1.1 with Reserved Font Name "Plex".

| File here | Upstream path | SHA-256 |
| --- | --- | --- |
| `ibm-plex-mono/ibm-plex-mono-400.ba204497f16b6d33.woff2` | release asset `ibm-plex-mono.zip`, `ibm-plex-mono/fonts/complete/woff2/IBMPlexMono-Regular.woff2` | `ba204497f16b6d334cee9d1e963a831b73e3a56e1d6300a8489d18df7214b350` |
| `ibm-plex-mono/ibm-plex-mono-500.33faf307fa6031fb.woff2` | release asset `ibm-plex-mono.zip`, `ibm-plex-mono/fonts/complete/woff2/IBMPlexMono-Medium.woff2` | `33faf307fa6031fb4062276d7320a6d632de890cbb347576fd80cfa01077bc25` |
| `ibm-plex-mono/license.txt` | release asset `ibm-plex-mono.zip`, `ibm-plex-mono/fonts/complete/woff2/license.txt` (the copy beside the woff2, with LF line endings; the zip's root `LICENSE.txt` has the same text with CRLF) | `91c25c350d3cac39da2736d74f7ba37ef648f5237a4e330a240615bc8d8c4360` |

## Updating

Take new files from the publishers' releases only, never from a font CDN (they
re-subset). Rename each woff2 to the new hash, update `waitlist.<hash>.css` (and
rename it to its own new hash, after `npm run format`), `WAITLIST_STYLESHEET_PATH` in
`src/waitlist-pages.ts`, the table above and the test.
