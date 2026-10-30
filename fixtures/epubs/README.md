# Real epub fixtures (local only)

Put real AO3 `.epub` downloads here to run the `packages/epub` fixture tests
against them. They are fanworks, and this repo is public, so `*.epub` in this
folder is git-ignored. Never commit them, and don't copy their text into tests
or snapshots: assert on metadata, counts and short markers instead.

The tests read this folder in a Node `globalSetup` and pass the files into the
Workers runtime. With the folder empty, the fixture tests are skipped.

Expected values in `packages/epub/test/fixtures.test.ts` are keyed by file name
(`call-me-maybe.epub`, `cat-nap.epub`). Any other epub you drop in still gets the
generic checks: it parses, the output is deterministic, and the HTML is sanitized.
