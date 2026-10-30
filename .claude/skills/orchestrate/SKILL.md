---
name: orchestrate
description: Run a wave of work items on this repository with engineering subagents. Proposes the wave from the frontier, sends an explorer ahead of each ticket to write notes into a shared scratchpad, picks a model per ticket from its complexity, launches one fresh engineer per ticket in its own worktree and branch, escalates to a higher-tier model when an agent isn't confident, and keeps the ledger current. Use when asked to work, build or orchestrate tickets, a lane or the frontier.
argument-hint: "[issue numbers, item ids, a lane, or 'frontier']"
disable-model-invocation: true
---

# Orchestrate a wave

You direct; the agents build. You read tickets, notes and reports, choose models, launch and answer agents, and keep the ledger. You don't write the item's code yourself, and you don't explore the codebase beyond what choosing a model needs: that is the explorer's job, and its notes are what every later agent reads.

The process this runs inside is `docs/process.md`. The gate is `/gate` (`.claude/skills/gate/SKILL.md`), and tickets come from `/to-tickets`. Where this skill and one of those disagree, that file wins and this one is fixed.

The agent types live in `.claude/agents/`:

| Type | Does | Repo access | Worktree |
|------|------|-------------|----------|
| `explorer` | Reads the ticket, the code and external docs; writes notes | Read only | No: it writes only to the scratchpad |
| `engineer` | Builds one ticket, gates it, opens its PR | Read and write | Yes, its own, on its own branch |
| `consultant` | Answers one hard question at a higher tier | Read only | No |

## Models

Edit this table to retune. The tiers, lowest first: `haiku` < `sonnet` < `opus` < `fable`. Fable is the most capable and the most expensive, and needs Fable access on the account. Without it, the top tier is `opus`, and a consult that would go to `fable` goes to the operator instead.

| Pick | When the ticket is |
|------|--------------------|
| `haiku` | Tier 0 prose, or a mechanical batch (an expand-migrate-contract step) whose notes name every file and the exact change |
| `sonnet` | Test-only (expected gate tier 2), or a code change of one workspace that follows a pattern the notes point to |
| `opus` | Expected tier 3: crosses layers (migration, ingest, route, page), touches the security boundary, or is the first ticket in a new workspace (W1, D1, M1, C1, I1) |
| `fable` | Consults only, by default. Build on it only when the operator says so for an item |

Explorers run on `sonnet`, or on `opus` when the ticket touches the security boundary or leans on external docs the repo doesn't hold (Better Auth, Cloudflare bindings, Resend, R2 presigning). A consult runs one tier above the agent asking.

Assess before you pick. Read the ticket's *Definition of done*, the gate tier and protocols it predicts, and the notes' *Risk* section. When two rows fit, take the higher. Write one line per ticket, "<item>: <model> because <reason>", into the wave plan you show the operator.

## Escalation

When you or any agent meets a problem it can't solve with confidence, it doesn't guess. The ladder, the same for everyone:

1. **The advisor tool,** when the session has one. It sees the whole transcript, so it needs no brief. Subagents inherit it when their model is below the advisor's.
2. **A consult.** Spawn a `consultant` one tier up, with the question, what was tried, the two or three options in view, and the absolute paths of the notes and the files in question. Save its answer to `<scratch>/<ITEM>/consults/<n>.md`, and cite that file in the report.
3. **The operator.** When the consultant answers *unsure*, when the top tier was the one asking, or when the question is a design decision. Report it as a stop event, in the shape of the gate's *Deviations*.

What counts as not confident:

- The same check fails after two different attempts at a fix.
- Code on the security boundary (the gate's tier 3 list) that no test shows correct.
- A choice that is hard to undo: a schema shape, a key layout in R2, a queue message format, a public URL.
- Behaviour the runtime decides and the notes don't settle: workerd, Hyperdrive, Queues, `HTMLRewriter`.

A question the docs leave open is never a consult. Models don't decide open design questions (`/to-tickets`, *Rules for every ticket*); it goes to the operator.

## 1. Set up the scratchpad

Every agent reads and writes notes under one root, `<scratch>`: `orchestrate/` inside your session's scratchpad directory. Use its absolute path in every brief, because subagents aren't told it.

```
<scratch>/
  wave.md                plan, models, and each agent's id and branch
  shared/
    conventions.md       repo-wide: workspaces, test setup, commands, patterns
  <ITEM>/
    notes.md             the explorer's notes for one ticket
    consults/<n>.md      consult answers
    report.md            the engineer's final report
```

The scratchpad lasts for this session. Notes hold no fic text and no reader data: they are about code and docs only.

## 2. Propose the wave

1. `git fetch`. Explorers read code as it is on `origin/main`, which is what each engineer's worktree starts from.
2. Find the frontier: open items in `docs/project-tracking.md` whose `Depends on:` issues are all closed (`gh issue list --state closed`, or `gh issue view <n>`). Narrow it to what the arguments name.
3. Query the ledger's `agents` for `running` and `idle` rows. Don't propose an item someone is already building.
4. Show the operator the proposed wave: each item, its issue, its predicted gate tier, and the model line from *Models*. Flag any two items likely to touch the same files (the root `package.json`, a shared type), since their worktrees will conflict at merge.

**Stop here until the operator names the items to start.** `docs/process.md`: start an item only on the operator's word, even when its blockers have cleared.

## 3. Explore

Launch one `explorer` per item, all in one message so they run at once. When `shared/conventions.md` doesn't exist yet, the first explorer's brief also asks for it, and the others are told to read it once it appears and not to duplicate it.

The brief:

```
Item <ITEM>, issue #<n>: <title>.
Scratch root: <absolute path to scratch>.
Write your notes to <scratch>/<ITEM>/notes.md.
<Also write <scratch>/shared/conventions.md. | Read <scratch>/shared/conventions.md; don't repeat it.>
Read code at origin/main: in this checkout, use `git show origin/main:<path>` for any file that differs.
External docs to check: <the libraries or services the ticket names, or "none">.
```

When the explorers report, read each `notes.md`. Every *Definition of done* bullet needs a line under *Plan by bullet*, and *Risk* needs to say why. Check *Seams* against `/tdd`: each is a public boundary, not an internal function, and together they reach every bullet. Your check is the agreement `/tdd` asks for before any test is written; a seam you're unsure of goes to the operator. Send a gap back to the same explorer with `SendMessage`. Then settle each item's model.

## 4. Build

Launch one `engineer` per item: a fresh agent, never a fork and never one reused from another ticket. Its definition puts it in its own worktree. Pass `model` from *Models* on each call, and launch the wave's engineers in one message so they run at once. The brief:

```
Item <ITEM>, issue #<n>: <title>.
Branch: claude/<item id, lowercase>-<short slug>.
Scratch root: <absolute path to scratch>.
Read first: <scratch>/shared/conventions.md, <scratch>/<ITEM>/notes.md.
Your model tier: <model>. Consult at: <next tier up, or "the operator">.
Write your final report to <scratch>/<ITEM>/report.md as well as returning it.
```

Write each agent's id, model, branch and start time into `wave.md` and onto the ledger.

An engineer writes under `<scratch>` from outside its worktree, so it may raise a permission prompt in your session. That's expected: approve writes under `<scratch>`, and nothing else from outside its worktree. Its report also comes back as text, so a declined write loses nothing.

## 5. Handle what comes back

Each engineer ends with one status:

- **`pr-open`**: the PR exists and its body has `/gate`'s *What was run* block. Read `report.md`, check the PR (`gh pr view <n>`), and set the item to `gating` on the ledger. Read its *Seams added*: one that tests an internal goes back to the engineer. The wave stops here for that item: the merge ladder (`/gate merge`) and the merge itself are the operator's call.
- **`needs-consult`**: the engineer couldn't run its own consult. Run the consult (*Escalation*, step 2), then send the answer to the same engineer with `SendMessage`.
- **`stopped`**: a stop event or an open question. Put it to the operator with the engineer's evidence. When they rule, send the ruling to the same engineer, quoting their words.
- **`failed`**: say what failed and what the branch holds. Ask the operator whether to relaunch, on the same model or one tier up.

Review rework on an open PR goes to the same engineer with `SendMessage`, so it keeps its context. "One fresh agent per ticket" means per ticket, not per round.

When an item touched files that another open PR in the wave also touched, the second to merge brings main in and resolves; send that to its engineer once the first merges.

## 6. Keep the ledger

The ledger is described in `docs/process.md`, *The ledger*. Write it through ArtifactData, with times from `date -u`:

- **At each launch:** an `agents` row with `item`, `model`, `lane`, `status: "running"` and `startedAt`. The kind follows the agent type: `explorer` (name `<ITEM> explorer`), `builder` for an engineer (name `<ITEM> engineer`), or `consultant` (name `<ITEM> consult <n>`, with the question in a line as its `note`). At an engineer's launch, set the item's `status` to `building` and its `model`.
- **At each report:** an explorer's or consultant's row becomes `finished`, with `finishedAt`; a consultant's `note` gets its confidence and the answer's file. An engineer at `pr-open` becomes `idle` with its `pr`, since review rework may come back to it; it becomes `finished` when its PR merges or the operator closes the item. An engineer that `failed` becomes `failed`.
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
