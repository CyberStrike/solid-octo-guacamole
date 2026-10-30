# Process

Where planning lives and how work is tracked, so none of it depends on one session's memory. The design is `docs/ARCHITECTURE.md` and `docs/FRONTEND-DISCOVERY.md`. The acceptance criteria are `specs/scenarios/`. The gate is `.claude/skills/gate/SKILL.md`, tickets come from `.claude/skills/to-tickets/SKILL.md`, waves of items are run by `.claude/skills/orchestrate/SKILL.md`, and items are built test-first by `.claude/skills/tdd/SKILL.md`. Where this file and one of those disagree, that file wins and this one is fixed.

Adapted from the folio project's ledger.

## Where things live

| What | Where |
|------|-------|
| Design and decisions | `docs/ARCHITECTURE.md` (its *Decisions so far* table is binding), `docs/FRONTEND-DISCOVERY.md` |
| Acceptance criteria | `specs/scenarios/mvp/`, `specs/scenarios/later/` |
| Which issue is which work item | `docs/project-tracking.md` |
| Where each item is now | The ledger, https://claude.ai/artifact/TxUtdLCvqUiySs749b8sMn |
| The ledger page's source | `docs/ledger/page.html` |
| The ledger check | `scripts/ledger-check.mjs` |
| Running a wave of items | `/orchestrate`, with the agent types in `.claude/agents/` |

## Work items

- **One item is one issue, one branch, one PR.** It passes `/gate` before its PR opens and again before it merges.
- **Tickets are cut by `/to-tickets`.** Each issue's *Definition of done* cites scenario cases, and its `Depends on:` line names the issues that must merge first. The gate checks that each dependency is closed.
- **Order follows blockers.** Work the frontier: items whose blockers have all merged. Otherwise landing order doesn't matter, unless the operator marks an item critical.
- **Start an item only on the operator's word**, even when its blockers have cleared.
- **A wave runs under `/orchestrate`.** An explorer writes notes on each item into a shared scratchpad. Then a fresh engineer per item, on a model picked for that item, builds it test-first with `/tdd` in its own worktree and branch, and opens its PR after `/gate pr`. The merge ladder stays with the operator.

## The ledger

The ledger is a claude.ai page whose content is a shared database. Only editors write it, through the ArtifactData tool:
- `set` creates a document.
- `update`, guarded by `if_version`, changes one.
- `batch` sends several at once.

The page is never republished to change its data. `docs/project-tracking.md` stays the record of which issue is which item; the ledger records where each one is.

Collections, with the fields `docs/ledger/page.html` reads:

- **`lanes`**: id, name, scope, issue, order. A lane is a group of items, such as an area of the work.
- **`items`**: the doc id is the work-item id. Fields:
  - label?, lane, order, title, issue, pr[], status, gates[], model?, mergedAt, note
  - status is one of:
    - `queued` or `waiting` (Ready)
    - `building`, `running` or `blocked` (In progress)
    - `gating` or `review` (Testing)
    - `merged`, `done` or `closed` (Done; `closed` for an item that ended without merging)
  - `gates` names the items that must merge first: the issue's `Depends on:` line.
- **`agents`**: one doc per explorer, builder, consultant, gate or reviewer. Fields:
  - kind (`explorer`, `builder`, `consultant`, `gate` or `reviewer`), name, item (or task, for work with no item), model, lane, step, pr[], startedAt, finishedAt, note
  - status is `running`, `idle`, `finished` or `failed`
- **`questions`**: one per open design question, with id `Q<n>`, title, state (`open` or `closed`), proceeding and note.
- **`reviews`**: the operator's task list, with title, detail, ref, url, order and state (`open` or `done`).
- **`followups`**: one per follow-up issue (adjacent problems and audit findings, not work items), with issue, title, note, status (`open`, `review`, `running` or `closed`), workspace, waitsOn[] and pr[].
- **`log`**: one document per day, `log/<YYYY-MM-DD>`, with `day` and `entries[{at, text}]`. Entries are appended to it, never one document per event.

The document `meta/state` holds `main` (short sha) and `updatedAt`, which the page header shows.

Rules:

- **When to update:** at every launch, report, merge, filed issue, question closure and operator ruling.
- **Real times only:** every time on it comes from `date -u`, a commit, or GitHub's `mergedAt`. Never an estimate.
- **Before a status summary,** query `agents` for `running` and `idle` rows and reconcile them with what is actually running.
- **After every merge and every hand-back,** check the ledger against GitHub with `scripts/ledger-check.mjs`, from a checkout of this repository:
  1. Export `items`, `agents`, `followups` and `log` with ArtifactData `list`, with `out_dir` set to one new directory and `query.limit` 1000. Export `meta/state` with `get` into the same directory.
  2. Run `node scripts/ledger-check.mjs <dir>`. It prints every disagreement and exits 0 when there are none.
  3. If it names documents that `versions.json` lacks (exit 2), write `<dir>/versions.json` mapping each `"<collection>/<doc id>"` to the version the listing printed, and run it again.
  4. Send each entry of `batches` in `<dir>/changes.json` as one ArtifactData `batch`, in order. Every entry is pinned to a version, so a document changed since the export refuses its whole batch; export again and repeat.
  5. Settle by hand what it only reports, then log the run.
- **What the check writes:** only what GitHub decides, such as an item whose PRs merged becoming `merged` with the real `mergedAt`, a follow-up whose issue closed becoming `closed`, and `meta/state` getting `main`'s head. Everything else it only reports.
- **Changing the page:** edit `docs/ledger/page.html`, redeploy it to the ledger's URL with the Artifact tool, and commit the change.
