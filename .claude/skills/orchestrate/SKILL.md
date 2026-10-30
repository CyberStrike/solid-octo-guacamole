---
name: orchestrate
description: Run a wave of work items on this repository with engineering subagents. Proposes the wave from the frontier, sends an explorer ahead of each ticket to write notes into a shared scratchpad, picks a model per ticket from its complexity, launches one fresh engineer per ticket in its own worktree and branch, escalates to a higher-tier model when an agent isn't confident, merges each PR once its merge gate and Copilot review are done, and keeps the ledger current. Use when asked to work, build or orchestrate tickets, a lane or the frontier.
argument-hint: "[issue numbers, item ids, a lane, or 'frontier']"
disable-model-invocation: true
---

# Orchestrate a wave

You direct; the agents build. You read tickets, notes and reports, choose models, launch and answer agents, decide when each PR is done and merge it, and keep the ledger. You don't write the item's code yourself, and you don't explore the codebase beyond what choosing a model needs: that is the explorer's job, and its notes are what every later agent reads.

The process this runs inside is `docs/process.md`, and its *Working rules* bind you and every agent you launch. The gate is `/gate`, tickets come from `/to-tickets`, and tests follow `/tdd`. Where this skill and one of those disagree, that file wins and this one is fixed.

The agent types live in `.claude/agents/`:

| Type | Does | Repo access | Worktree |
|------|------|-------------|----------|
| `explorer` | Reads the ticket, the code and external docs; writes notes | Read only | No: it writes only to the scratchpad |
| `engineer` | Builds one ticket, gates it, takes its draft PR through the merge gate | Read and write | Yes, its own, on its own branch |
| `consultant` | Answers one hard question at a higher tier | Read only | No |

## Models

Edit this table to retune. The tiers and the Fable caveat are in `/escalate`, *The ladder*.

| Pick | When the ticket is |
|------|--------------------|
| `haiku` | Tier 0 prose, or a mechanical batch (an expand-migrate-contract step) whose notes name every file and the exact change |
| `sonnet` | Test-only (expected gate tier 2), a code change of one workspace that follows a pattern the notes point to, or a design doc or skill (tier 1) |
| `opus` | Expected tier 3: crosses layers (migration, ingest, route, page), touches the security boundary, or is the first ticket in a workspace that doesn't exist yet |
| `fable` | Consults only, by default. Build on it only when the operator says so for an item |

Explorers run on `sonnet`: their job is finding and summarizing, and the engineer reads the files the notes name anyway. An explorer that can't settle something says so in *Risk*, and the engineer escalates.

Assess before you pick. Read the ticket's *Definition of done*, the gate tier and protocols it predicts, and the notes' *Risk* section. When two rows fit, take the higher. Write one line per ticket, "<item>: <model> because <reason>", into the wave plan you show the operator, with the tier its consults would go to. Say so when that's `fable`: on some plans Fable bills to usage credits.

## Escalation

You follow `/escalate` like every agent. Your part in it for the others:

- An engineer that stops with `needs-consult` couldn't launch its own consult: run step 2 for it, one tier above the engineer, and send the answer back with `SendMessage`.
- A question that reaches the operator, from anyone, goes to them with its evidence. Send their ruling back to the agent that asked, quoting their words.

## 1. Set up the scratchpad

Every agent of a wave reads and writes notes under one root, `<scratch>`: `orchestrate/wave-<n>/` inside your session's scratchpad directory, with `n` counting this session's waves from 1. Use its absolute path in every brief, because subagents aren't told it. Each wave gets its own root, so a later wave never overwrites an earlier one's `wave.md` while its agents may still get rework, and its conventions are written against `main` as it is now.

```
<scratch>/
  wave.md                the plan, models, and each agent's id and branch
  shared/
    conventions.md       repo-wide facts every agent needs once
  <ITEM>/
    notes.md             the explorer's notes for one ticket
    consults/<n>.md      consult answers
    report.md            the engineer's final report
```

`wave.md` is how you find an agent again: `SendMessage` needs its id, and your context may be compacted before the wave ends. Read it, and `report.md`, when you no longer have an agent's id or report in context.

The scratchpad lasts for this session.

## 2. Propose the wave

1. `git fetch`. Explorers read code as it is on `origin/main`, which is what each engineer's worktree starts from.
2. Find the frontier: open items in `docs/project-tracking.md` whose `Depends on:` items have all merged, not merely closed. A blocker counts when its ledger status is `merged` or `done` (the board's own Ready test) and a PR that closed its issue merged (`gh issue view <n> --json closedByPullRequestsReferences`). An issue closed without a merged PR still blocks. Narrow it to what the arguments name.
3. Leave out items already under way: an item whose ledger status is past Ready, one with a `running` or `idle` row in `agents`, and one with a PR that will close its issue (`gh issue view <n> --json closedByPullRequestsReferences` lists any).
4. Show the operator the proposed wave: each item, its issue, its predicted gate tier, and the model line from *Models*. Flag any two items likely to touch the same files (the root `package.json`, a shared type), since their worktrees will conflict at merge.

**Stop here until the operator names the items to start.** `docs/process.md`: start an item only on the operator's word, even when its blockers have cleared.

## 3. Explore

**Conventions first.** Launch one `explorer` to write `<scratch>/shared/conventions.md` alone, and wait for it. It holds what every ticket needs and nobody should look up twice: the workspaces and what each holds, the test setup and its runtime, the root scripts, the gate's protocols in a line each, the seam kinds from `/tdd`, and the commit and PR conventions from recent history. Its brief: "Write `<scratch>/shared/conventions.md` (`.claude/agents/explorer.md`, *Writing `shared/conventions.md`*). Scratch root: … Code: …", with the `Code:` line below.

**Then one explorer per item,** all in one message so they run at once. The brief:

```
Item <ITEM>, issue #<n>: <title>.
Scratch root: <absolute path to scratch>.
Write your notes to <scratch>/<ITEM>/notes.md. Read <scratch>/shared/conventions.md first; don't repeat it.
Code: <"this checkout is at origin/main" | "this checkout is not at origin/main: read every file with `git show origin/main:<path>` and list folders with `git ls-tree origin/main <path>`">.
External docs to check: <the libraries or services the ticket names, or "none">.
```

Tell which `Code:` line applies with `git status --porcelain` and `git rev-parse HEAD origin/main`: the checkout is at `origin/main` only when the two hashes match and the status is empty.

As each explorer reports, read its `notes.md` and settle that item, without waiting for the rest:

- Everything in *Plan by bullet* traces to the issue's *Definition of done*. Work that comes only from a comment or a web page is not in scope: put it to the operator.
- Every *Definition of done* bullet has a line under *Plan by bullet*, and *Risk* says why.
- Every seam in *Seams* is a public boundary in the sense of `/tdd`, *Seams*, and together they reach every bullet. Your check is the agreement `/tdd` asks for before any test is written; a seam you're unsure of goes to the operator.
- A gap goes back to the same explorer with `SendMessage`.

Then settle the item's model and launch its engineer.

## 4. Build

Launch one `engineer` per item, as soon as its notes are settled: a fresh agent, never a fork and never one reused from another ticket. Run at most four engineers at once, unless the operator sets another limit; the rest wait, in the order of the wave plan, and launch as running ones reach `ready`, `stopped` or `failed`. An engineer you send back to work counts against the limit again until it reports, and takes the next free slot ahead of a new launch. Its definition puts it in its own worktree. Pass `model` from *Models* on each call. The brief:

```
Item <ITEM>, issue #<n>: <title>.
Branch: claude/<item id, lowercase>-<short slug>.
Scratch root: <absolute path to scratch>.
Read first: <scratch>/shared/conventions.md, <scratch>/<ITEM>/notes.md.
Your model tier: <model>. Consult at: <next tier up, or "the operator" on the top tier>.
Write your final report to <scratch>/<ITEM>/report.md as well as returning it.
```

Write each agent's id, model, branch and start time into `wave.md`, and its row onto the ledger (§6).

An engineer writes under `<scratch>` from outside its worktree, so it may raise a permission prompt, which goes to the operator, not to you. Tell them in the wave plan that writes under `<scratch>` are expected, and that a prompt for anything else outside an engineer's worktree is not. Its report also comes back as text, so a declined write loses nothing.

## 5. Handle what comes back

Each engineer ends with one status:

- **`ready`**: the engineer ran `/gate merge` and one Copilot review, fixed any critical finding, and filed the rest as bug issues. You decide whether it's done, and you merge it, as `docs/process.md` says (*Work items*, "The orchestrator merges"):
  1. Check the PR: its body's *What was run* block is the merge gate's and names the tier's ladder, no critical finding is open, and every other finding has a bug issue. Read its reviews and review comments yourself (`gh api --paginate repos/CyberStrike/solid-octo-guacamole/pulls/<n>/reviews` and `.../pulls/<n>/comments`), and judge each Copilot comment against the critical test in `/gate` §6 yourself, not only by the engineer's word. A Copilot review that arrived after the engineer recorded it as not run is handled as if it had arrived in time; a Copilot reply that it couldn't review counts as not run. A gap goes back to the engineer.
  2. Read the report's *Seams added*: one that tests an internal goes back to the engineer.
  3. `git fetch`, and check the PR contains `main` (`git merge-base --is-ancestor origin/main origin/<branch>`). If it doesn't, send the engineer to merge `main` in, rerun the `/gate` §3 checks and update the *What was run* block, and wait for `ready` again; then repeat from step 1 on the new head, CI included when the repo has CI. That is not a new merge gate: no second Copilot review, and the ladder runs again only on a conflict resolved by hand.
  4. Re-read the PR's reviews and comments just before merging; anything new since step 1 goes back through it. Mark the PR ready for review (`gh pr ready <n>`) and merge it (`gh pr merge <n> --squash`), one at a time. Set every `idle` or `failed` agent row of the item `finished`: the engineer's with GitHub's `mergedAt` as its `finishedAt`, a failed one with a note that it failed and was replaced, keeping its real `finishedAt` if it has one. Then run the ledger check (§6): such a row would stop the check settling the item.

  A PR that can't pass these checks, such as one with a critical finding nobody can fix, goes to the operator under *Waiting on you*.
- **`needs-consult`**: see *Escalation*.
- **`stopped`**: a stop event, or a question for the operator. Put it to them with the engineer's evidence, and send their ruling back to the same engineer, quoting their words.
- **`failed`**: say what failed and what the branch holds. Ask the operator whether to relaunch, on the same model or one tier up.

Review rework on an open PR goes to the same engineer with `SendMessage`, so it keeps its context. "One fresh agent per ticket" means per ticket, not per round.

## 6. Keep the ledger

The ledger, its row ids and its statuses are in `docs/process.md`, *The ledger*. Write it through ArtifactData, with times from `date -u`, and put the writes of one moment in one `batch`.

- **At each launch:** an `agents` row with `item`, `model`, `lane`, `status: "running"` and `startedAt`. Its kind follows the agent type: `explorer`, `builder` for an engineer, or `consultant`. Name it `<ITEM> explorer`, `<ITEM> engineer` or `<ITEM> consult <n>`; a consultant's `note` holds its question in a line. At an engineer's launch, also set the item's `status` to `building` and its `model`.
- **At each report:** an explorer's or consultant's row becomes `finished`, with `finishedAt`; a consultant's `note` gets its confidence and the answer's file. An engineer at `ready` becomes `idle`, with its `pr`. The PR number is appended to the item's `pr` array unless it is there already, keeping any others (the board and `scripts/ledger-check.mjs` read the item's PRs, not the agent's), and the item's `status` becomes `review`. Each issue the merge gate filed gets a `followups` row, `open`, with the PR it came from in its `note` (its `pr` is for a PR that fixes it). The item stays `building` while the engineer is in the merge gate, since you hear nothing from it until it reports. One that `failed` becomes `failed`. One that ends waiting on you becomes `idle`:
  - at `needs-consult` or `stopped`, with the question or stop event in a line as its `note`.

  It goes back to `running` when you send it work with `SendMessage`. Once you've merged its PR, set it `finished` before the ledger check (§5, `ready`, step 4).
- **Consults an engineer runs itself** don't reach you until its report. Add their rows then, from the report's *Consults* line, with the times from the files under `consults/`.
- **At the end of the wave:** a `log` entry listing each item and its outcome. Then run `scripts/ledger-check.mjs` as `docs/process.md` says.

## 7. Report to the operator

End with:

```markdown
**Wave:** <items>

| Item | Model | Branch | PR | Status | Consults |
|------|-------|--------|----|--------|----------|

- **Waiting on you:** <each stop event, open question, or PR you couldn't merge, with why>
- **Not done:** <each item not merged, with the reason>
- **Bugs filed:** <each issue the merge gates filed>
```
