---
name: orchestrate
description: Run a wave of work items on this repository with engineering subagents. Proposes the wave from the frontier, sends an explorer ahead of each ticket to write notes into a shared scratchpad, picks a model per ticket from its complexity, launches one fresh engineer per ticket in its own worktree and branch, escalates to a higher-tier model when an agent isn't confident, and keeps the ledger current. Use when asked to work, build or orchestrate tickets, a lane or the frontier.
argument-hint: "[issue numbers, item ids, a lane, or 'frontier']"
disable-model-invocation: true
---

# Orchestrate a wave

You direct; the agents build. You read tickets, notes and reports, choose models, launch and answer agents, and keep the ledger. You don't write the item's code yourself, and you don't explore the codebase beyond what choosing a model needs: that is the explorer's job, and its notes are what every later agent reads.

The process this runs inside is `docs/process.md`, and its *Working rules* bind you and every agent you launch. The gate is `/gate`, tickets come from `/to-tickets`, and tests follow `/tdd`. Where this skill and one of those disagree, that file wins and this one is fixed.

The agent types live in `.claude/agents/`:

| Type | Does | Repo access | Worktree |
|------|------|-------------|----------|
| `explorer` | Reads the ticket, the code and external docs; writes notes | Read only | No: it writes only to the scratchpad |
| `engineer` | Builds one ticket, gates it, opens its PR | Read and write | Yes, its own, on its own branch |
| `consultant` | Answers one hard question at a higher tier | Read only | No |

## Models

Edit this table to retune. The tiers and the Fable caveat are in `/escalate`, *The ladder*.

| Pick | When the ticket is |
|------|--------------------|
| `haiku` | Tier 0 prose, or a mechanical batch (an expand-migrate-contract step) whose notes name every file and the exact change |
| `sonnet` | Test-only (expected gate tier 2), or a code change of one workspace that follows a pattern the notes point to |
| `opus` | Expected tier 3: crosses layers (migration, ingest, route, page), touches the security boundary, or is the first ticket in a workspace that doesn't exist yet |
| `fable` | Consults only, by default. Build on it only when the operator says so for an item |

Explorers run on `sonnet`: their job is finding and summarizing, and the engineer reads the files the notes name anyway. An explorer that can't settle something says so in *Risk*, and the engineer escalates.

Assess before you pick. Read the ticket's *Definition of done*, the gate tier and protocols it predicts, and the notes' *Risk* section. When two rows fit, take the higher. Write one line per ticket, "<item>: <model> because <reason>", into the wave plan you show the operator, with the tier its consults would go to. Say so when that's `fable`: on some plans Fable bills to usage credits.

## Escalation

You follow `/escalate` like every agent. Your part in it for the others:

- An engineer that stops with `needs-consult` couldn't launch its own consult: run step 2 for it, one tier above the engineer, and send the answer back with `SendMessage`.
- A question that reaches the operator, from anyone, goes to them with its evidence. Send their ruling back to the agent that asked, quoting their words.

## 1. Set up the scratchpad

Every agent reads and writes notes under one root, `<scratch>`: `orchestrate/` inside your session's scratchpad directory. Use its absolute path in every brief, because subagents aren't told it.

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
2. Find the frontier: open items in `docs/project-tracking.md` whose `Depends on:` issues are all closed (`gh issue view <n>`). Narrow it to what the arguments name.
3. Leave out items already under way: an item whose ledger status is past Ready, one with a `running` or `idle` row in `agents`, and one with a PR that will close its issue (`gh issue view <n> --json closedByPullRequestsReferences` lists any).
4. Show the operator the proposed wave: each item, its issue, its predicted gate tier, and the model line from *Models*. Flag any two items likely to touch the same files (the root `package.json`, a shared type), since their worktrees will conflict at merge.

**Stop here until the operator names the items to start.** `docs/process.md`: start an item only on the operator's word, even when its blockers have cleared.

## 3. Explore

**Conventions first.** When `<scratch>/shared/conventions.md` doesn't exist, launch one `explorer` to write it alone, and wait for it. It holds what every ticket needs and nobody should look up twice: the workspaces and what each holds, the test setup and its runtime, the root scripts, the gate's protocols in a line each, the seam kinds from `/tdd`, and the commit and PR conventions from recent history. Its brief: "Write `<scratch>/shared/conventions.md` (`.claude/agents/explorer.md`, *Writing `shared/conventions.md`*). Scratch root: … Code: …", with the `Code:` line below.

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

Launch one `engineer` per item, as soon as its notes are settled: a fresh agent, never a fork and never one reused from another ticket. Its definition puts it in its own worktree. Pass `model` from *Models* on each call. The brief:

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

- **`pr-open`**: the PR exists and its body has `/gate`'s *What was run* block. Check the PR (`gh pr view <n>`), and set the item to `gating` on the ledger. Read the report's *Seams added*: one that tests an internal goes back to the engineer. The wave stops here for that item: the merge ladder (`/gate merge`) and the merge itself are the operator's call.
- **`needs-consult`**: see *Escalation*.
- **`stopped`**: a stop event, or a question for the operator. Put it to them with the engineer's evidence, and send their ruling back to the same engineer, quoting their words.
- **`failed`**: say what failed and what the branch holds. Ask the operator whether to relaunch, on the same model or one tier up.

Review rework on an open PR goes to the same engineer with `SendMessage`, so it keeps its context. "One fresh agent per ticket" means per ticket, not per round.

When an item touched files that another open PR in the wave also touched, the second to merge brings main in and resolves; send that to its engineer once the first merges.

## 6. Keep the ledger

The ledger, its row ids and its statuses are in `docs/process.md`, *The ledger*. Write it through ArtifactData, with times from `date -u`, and put the writes of one moment in one `batch`.

- **At each launch:** an `agents` row with `item`, `model`, `lane`, `status: "running"` and `startedAt`. Its kind follows the agent type: `explorer`, `builder` for an engineer, or `consultant`. Name it `<ITEM> explorer`, `<ITEM> engineer` or `<ITEM> consult <n>`; a consultant's `note` holds its question in a line. At an engineer's launch, also set the item's `status` to `building` and its `model`.
- **At each report:** an explorer's or consultant's row becomes `finished`, with `finishedAt`; a consultant's `note` gets its confidence and the answer's file. An engineer at `pr-open` becomes `idle` with its `pr`; one that `failed` becomes `failed`. When its PR later merges, `scripts/ledger-check.mjs` reports the `idle` row, and you set it `finished`.
- **Consults an engineer runs itself** don't reach you until its report. Add their rows then, from the report's *Consults* line, with the times from the files under `consults/`.
- **At the end of the wave:** a `log` entry listing each item and its outcome. Then run `scripts/ledger-check.mjs` as `docs/process.md` says.

## 7. Report to the operator

End with:

```markdown
**Wave:** <items>

| Item | Model | Branch | PR | Status | Consults |
|------|-------|--------|----|--------|----------|

- **Waiting on you:** <each stop event, open question or merge ready for `/gate merge`>
- **Not done:** <each item not at pr-open, with the reason>
```
