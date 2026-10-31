# Real epub fixtures (local only)

Put real AO3 `.epub` downloads here to run the `packages/epub` fixture tests
against them. They are fanworks, and this repo is public, so `*.epub` in this
folder is git-ignored. Never commit them, and don't copy their text into tests
or snapshots. Name them neutrally (`one-shot-02.epub`, `one-shot-01.epub`),
never after the work.

The tests read this folder in a Node `globalSetup` and pass the files into the
Workers runtime. With the folder empty, the fixture tests are skipped.

Expected values live in `expected.json` here, which is git-ignored too: one entry per
file name, shaped like `expected.example.json` (placeholder values only). Every real
string in it (title, pseud, fandom, work id, the chapter's opening) is stored as the
SHA-256 hex digest of its UTF-8 bytes, so the file holds no readable text. That is
for not keeping text around, not for secrecy: short or public strings can be guessed
from their digests, so never commit this file. A
fixture with no entry still gets the generic checks: it parses, the output is
deterministic, and the HTML is sanitized. Its preface and chapter checks are skipped.
