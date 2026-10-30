---
name: tdd
description: Test-driven development on this repository. Builds a work item or fixes a bug test-first, one red-green slice per scenario case or definition-of-done bullet, at seams agreed before any test is written, in Node unless a dependency needs workerd. Use when building or fixing anything here test-first, when an engineer agent builds a ticket, or when asked about red-green-refactor or where a test belongs.
---

# Test-driven development

TDD is the red → green loop. This skill is what makes the loop produce tests worth keeping here: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle: consult them before and during the loop, not after.

Adapted from Matt Pocock's [`tdd`](https://github.com/mattpocock/skills/tree/main/skills/engineering/tdd) skill (MIT, Copyright (c) 2026 Matt Pocock). The upstream license is in `LICENSE-upstream.md` next to this file.

Use the docs' vocabulary in test names and interfaces: work, version, chapter, upload, pseud, opt-out, review reason, rejection code. `docs/ARCHITECTURE.md`'s *Decisions so far* table is binding on tests as on code.

## Where the tests come from

Each ticket's *Definition of done* cites scenario cases (`specs/scenarios/`), written GIVEN / WHEN / THEN. Each case is one slice:

- **GIVEN** is the setup: a builder from the test helpers, seeded data, a binding's state.
- **WHEN** is the one call at the seam.
- **THEN** and its **AND** lines are the assertions, and their values are the expected values. They're the independent source of truth this loop needs.

Name the test after the case, so the gate can match each bullet to its test: `it("Dangerous elements are dropped", ...)` inside a `describe` named for the scenario file. This is for new tests; existing tests keep their names. A bullet that cites no case is stated so a test can show it; test it the same way. A bug fix starts with a test that reproduces the bug at its seam.

## What a good test is

Tests verify behaviour through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like the scenario case it comes from, and it survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples from this repo and [mocking.md](mocking.md) for what to stub: `.claude/skills/tdd/tests.md` and `.claude/skills/tdd/mocking.md` from the repo root, when this skill was preloaded and the links don't resolve.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behaviour without reaching inside. Tests live at seams, never against internals. Here the seams are:

| Seam | Test through |
|------|--------------|
| A library's exports (`packages/epub`, `packages/db`) | Its `src/index.ts` exports, such as `processEpub` |
| A Worker's HTTP surface (`apps/web`, `apps/content`) | `exports.default.fetch` from `cloudflare:workers`: a request in, a response out |
| A queue consumer (`apps/ingest`, `apps/mailer`) | Its `queue` handler with a message batch, then the state it's contracted to leave |

A consumer's contract is what it stores. The ingest job promises R2 objects under one prefix and rows in one transaction, so a test that reads R2 and Postgres after the job is reading the interface, not a side channel. Read them the way their consumer will: through the bindings and the `packages/db` queries the web Worker uses, not with ad hoc SQL.

**Test only at pre-agreed seams.** Before writing any test, write down the seams under test, each with a one-line note on what it catches and what it misses, and get them agreed:

- **Under `/orchestrate`,** the explorer proposes them in the notes' *Seams* section and the orchestrator checks them before the engineer starts. That's the agreement. A seam the engineer needs that the notes don't list goes under *Corrections* in `notes.md`, with its note, and into the report, so the orchestrator sees it.
- **Working with a person,** ask: "What's the public interface, and which seams should we test?" No test is written at an unconfirmed seam.

You can't test everything. Agreeing the seams up front puts the effort on the critical paths and the security boundary instead of on every edge case. When the shape of the interface is itself in question (how deep a module is, where the seam belongs, what it should expose) and the choice is hard to undo, that's a consult, not a guess (`/escalate`).

## Anti-patterns

- **Implementation-coupled:** mocks internal collaborators, tests private functions, or verifies through a side channel (querying a table the code under test doesn't promise to write). The tell: the test breaks when you refactor but behaviour hasn't changed. Importing a helper like `safeHref` from `src/sanitize` is fine only when it's a seam the notes agreed.
- **Tautological:** the assertion recomputes the expected value the way the code does, so it passes by construction and can never disagree with the code. Expected values come from an independent source: the scenario's THEN lines, `docs/ARCHITECTURE.md`, a known-good literal. A snapshot is tautological too when it's accepted from the code's own output: a snapshot guards against unintended change, but it is never the test that shows a bullet. Every bullet gets an explicit assertion. A changed snapshot needs its reason in the PR (`/gate`, epub protocol).
- **Horizontal slicing:** writing all the tests first, then all the implementation. Bulk tests verify *imagined* behaviour: they test the *shape* of things, go insensitive to real changes, and commit to a test structure before you understand the implementation. Work in **vertical slices**: one case → one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, and run it: `npx vitest run <file> -t "<case title>"` in the workspace. It must fail on its assertion, for the reason the case predicts. A test that fails on an import error or a typo hasn't been red yet. Then write only enough code to pass it. Don't anticipate later cases or add speculative features.
- **One slice at a time.** One seam, one case, one minimal implementation per cycle. Run the workspace's whole suite before you commit a slice.
- **Tests run in Node, unless a dependency needs workerd.** workerd is necessary only for code that reaches a Workers-only API: `HTMLRewriter` (so anything through `processEpub` and the sanitizer), a `cloudflare:*` module, or a Worker's `fetch` or `queue` entry with its bindings. Everything else, from pure logic to parsers, `packages/db` queries and `scripts/`, runs in Node, with no polyfills standing in for a Workers API. The reason is cost: workerd adds start-up time to every run and to every test file, which Node doesn't pay, while the tests themselves run no faster.
  - A workspace with both kinds splits them into two Vitest projects, so the Node tests don't pay for the runtime.
  - Keep logic out of the Worker shell, so it can be tested in Node, and leave the shell thin enough that a few workerd tests cover it.
  - A Node `globalSetup` reads files the runtime can't (see `packages/epub/test/global-setup.ts`).
- **No fic text in tests, fixtures or snapshots** (`docs/process.md`, *Working rules*). Build structure with the synthetic helpers (`ao3Epub`, `zipEntries` in `packages/epub/test/helpers.ts`). Real epubs under `fixtures/epubs/` are git-ignored and absent in CI, so their tests skip there: no bullet may depend on one alone.
- **Refactoring is not part of the loop.** It belongs to the review ladder (`/gate` §6), whose findings come back as review rework.
