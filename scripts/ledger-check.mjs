#!/usr/bin/env node
// Compares the operator's ledger with GitHub, which is the truth for what it records: a PR's
// state and merge time, an issue's state, main's head. It reads an export of the ledger's
// collections, prints every disagreement, and writes the changes that settle the ones GitHub can
// settle. See docs/process.md, "The ledger".
//
//   node scripts/ledger-check.mjs <export dir> [<changes file>]
//
// <export dir> holds <collection>/<doc id>.json for items, agents, followups and log, and
// meta/state.json, as ArtifactData's list (and get, for meta) with out_dir writes them. Exported
// files carry no version, so <export dir>/versions.json maps "<collection>/<doc id>" to the
// version the listing printed, for every document a change touches. The changes file (default
// <export dir>/changes.json) holds `batches`: ArtifactData batch entries, update and delete, at
// most 50 to a batch, each pinned to its version, with each update's data in a file under
// changes/ beside it.
// Exits 0 when the ledger agrees, 1 when it does not, and 2 when it cannot check or versions.json
// lacks a version a change needs; on 2 no changes file is written.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const [dirArg, outArg] = process.argv.slice(2);
if (!dirArg || !existsSync(dirArg)) {
  console.error("usage: node scripts/ledger-check.mjs <export dir> [<changes file>]");
  process.exit(2);
}
const dir = resolve(dirArg);
const out = resolve(outArg ?? join(dir, "changes.json"));
const dataDir = join(dirname(out), "changes");
rmSync(out, { force: true });
rmSync(dataDir, { recursive: true, force: true });

try {
  process.exit(await check());
} catch (error) {
  console.error(`ledger-check: cannot check: ${error.message ?? error}`);
  process.exit(2);
}

async function check() {
  const readJson = (path, fallback) =>
    existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
  // The file name is the document id; a field called id inside the document never overrides it.
  const read = (collection) => {
    const path = join(dir, collection);
    if (!existsSync(path)) return [];
    return readdirSync(path)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ ...readJson(join(path, f)), id: f.slice(0, -5) }));
  };
  const run = async (cmd, args) =>
    (await promisify(execFile)(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20 })).stdout;
  const byNumber = async (kind, fields) =>
    new Map(
      JSON.parse(
        await run("gh", [kind, "list", "--state", "all", "--limit", "3000", "--json", fields]),
      ).map((x) => [x.number, x]),
    );

  // main's head comes from GitHub, as the PR and issue states do, so a stale clone cannot move it
  // back.
  const [prs, issues, main] = await Promise.all([
    byNumber("pr", "number,state,mergedAt"),
    byNumber("issue", "number,state,closedAt"),
    run("gh", ["api", "repos/{owner}/{repo}/commits/main", "--jq", ".sha"]).then((s) =>
      s.trim().slice(0, 7),
    ),
  ]);

  // The statuses docs/process.md lists.
  const ITEM = new Set([
    "queued",
    "waiting",
    "building",
    "running",
    "blocked",
    "gating",
    "review",
    "merged",
    "done",
    "closed",
  ]);
  const AGENT = new Set(["running", "idle", "finished", "failed"]);
  const FOLLOWUP = new Set(["open", "review", "running", "closed"]);
  const DONE = new Set(["merged", "done", "closed"]);
  const DAY = /^\d{4}-\d{2}-\d{2}$/;

  const findings = [];
  /** @type {{ op: string, collection: string, doc_id: string, data?: object, group?: string }[]} */
  const writes = [];
  const say = (where, text) => findings.push(`${where}: ${text}`);
  const change = (collection, docId, data, why) => {
    writes.push({ op: "update", collection, doc_id: docId, data });
    say(`${collection}/${docId}`, `${why} → ${JSON.stringify(data)}`);
  };
  const latest = (times) => times.filter(Boolean).sort().at(-1);
  const prStates = (list) =>
    (Array.isArray(list) ? list : list == null ? [] : [list]).map(
      (n) => prs.get(Number(n)) ?? { number: n, state: "MISSING" },
    );
  const allMerged = (linked) => linked.length > 0 && linked.every((p) => p.state === "MERGED");

  const agents = read("agents");
  // An item an agent is still working on is not settled by its PRs alone: another may follow.
  const working = new Map(
    agents
      .filter((a) => ["running", "idle", "failed"].includes(a.status) && a.item)
      .map((a) => [a.item, a.id]),
  );

  for (const item of read("items")) {
    const where = `items/${item.id}`;
    if (!ITEM.has(item.status))
      say(where, `status "${item.status}" is not one docs/process.md lists`);
    const linked = prStates(item.pr);
    const missing = linked.filter((p) => p.state === "MISSING");
    for (const p of missing) say(where, `PR #${p.number} does not exist`);
    // A PR GitHub did not return may still be open, so nothing about the item is settled.
    if (missing.length) continue;
    const open = linked.filter((p) => p.state === "OPEN");
    const merged = linked.filter((p) => p.state === "MERGED");
    // Settled: no PR is still open and at least one merged; one closed unmerged was replaced.
    const settled = linked.length > 0 && !open.length && merged.length > 0;
    const mergedAt = latest(merged.map((p) => p.mergedAt));
    if (DONE.has(item.status)) {
      if (open.length) say(where, `status "${item.status}" but PR #${open[0].number} is open`);
      // `closed` is an item that ended without merging; `merged` or `done` needs a merged PR.
      else if (item.status !== "closed" && linked.length && !merged.length)
        say(where, `status "${item.status}" but every PR closed without merging`);
      else if (settled && !item.mergedAt)
        change("items", item.id, { mergedAt }, "done without mergedAt");
      else if (settled && Date.parse(item.mergedAt) !== Date.parse(mergedAt))
        change("items", item.id, { mergedAt }, `mergedAt ${item.mergedAt} differs from GitHub's`);
      continue;
    }
    if (settled && working.has(item.id))
      say(where, `its PRs are settled but agents/${working.get(item.id)} is still active`);
    else if (settled)
      change(
        "items",
        item.id,
        { status: "merged", mergedAt },
        `its PRs are settled, status "${item.status}"`,
      );
    else if (linked.length && !open.length) say(where, "every PR closed without merging");
    else if (merged.length) say(where, "some of its PRs merged, others are open");
    else if (open.length && ["queued", "waiting"].includes(item.status))
      say(where, `has an open PR but status "${item.status}"`);
    else if (!linked.length && issues.get(item.issue)?.state === "CLOSED")
      say(where, `issue #${item.issue} is closed but status "${item.status}"`);
  }

  for (const agent of agents) {
    const where = `agents/${agent.id}`;
    if (DONE.has(agent.status)) {
      const hint = agent.finishedAt ? "" : "; add a real finishedAt if one is known";
      change(
        "agents",
        agent.id,
        { status: "finished" },
        `status "${agent.status}" is not an agent status${hint}`,
      );
      continue;
    }
    if (!AGENT.has(agent.status))
      say(where, `status "${agent.status}" is not one docs/process.md lists`);
    if (agent.status === "finished") continue;
    const linked = prStates(agent.pr);
    if (agent.status === "failed") {
      if (allMerged(linked)) say(where, "failed, and its PRs merged: set it finished with a note");
      continue;
    }
    if (!agent.startedAt) say(where, "no startedAt");
    if (agent.kind === "gate" && allMerged(linked))
      change(
        "agents",
        agent.id,
        { status: "finished", finishedAt: latest(linked.map((p) => p.mergedAt)) },
        "its PRs merged",
      );
    else if (allMerged(linked)) say(where, `status "${agent.status}" but its PRs merged`);
    else if (agent.finishedAt)
      say(where, `status "${agent.status}" with finishedAt ${agent.finishedAt}`);
  }

  // A follow-up may name a PR rather than an issue; a merged or closed one is closed too.
  for (const f of read("followups")) {
    const where = `followups/${f.id}`;
    if (!FOLLOWUP.has(f.status))
      say(where, `status "${f.status}" is not one docs/process.md lists`);
    const n = Number(f.issue ?? f.id);
    const issue = issues.get(n);
    const pr = prs.get(n);
    if (!issue && !pr) {
      say(where, `#${n} is neither an issue nor a PR`);
      continue;
    }
    const closed = issue ? issue.state === "CLOSED" : pr.state !== "OPEN";
    if (f.status === "closed") {
      if (!closed) say(where, `closed here but #${n} is open`);
    } else if (closed)
      change(
        "followups",
        f.id,
        { status: "closed" },
        issue ? `issue closed at ${issue.closedAt}` : `PR #${n} is ${pr.state.toLowerCase()}`,
      );
  }

  // One log document per day. An entry written as a document of its own is appended to its UTC
  // day after the entries already there, keeping the day's own order, and its document deleted.
  const logs = read("log");
  const days = new Map(logs.filter((d) => DAY.test(d.id)).map((d) => [d.id, d]));
  const strays = logs
    .filter((d) => !days.has(d.id))
    .sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  const folded = new Map();
  for (const { id, ...stray } of strays) {
    const where = `log/${id}`;
    // oxlint-disable-next-line deslop/no-runtime-typeof -- checks a field of the exported JSON before use
    const at = typeof stray.at === "string" ? stray.at : "";
    const day = DAY.test(at)
      ? at
      : Number.isNaN(Date.parse(at))
        ? ""
        : new Date(at).toISOString().slice(0, 10);
    if (!day || !stray.text) {
      say(where, "not a day document and has no at and text to fold");
      continue;
    }
    if (!days.has(day)) {
      say(where, `its day, log/${day}, is not in the export: export it and run again`);
      continue;
    }
    if (!folded.has(day)) folded.set(day, { entries: [...(days.get(day).entries ?? [])], ids: [] });
    const fold = folded.get(day);
    if (!fold.entries.some((e) => e.at === stray.at && e.text === stray.text))
      fold.entries.push(stray);
    fold.ids.push(id);
    say(where, `one entry as its own document; folded into log/${day}`);
  }
  // A day's update comes before its deletes and they share a batch, so no split loses an entry.
  for (const [day, { entries, ids }] of folded) {
    const group = `log/${day}`;
    writes.push({ op: "update", collection: "log", doc_id: day, data: { entries }, group });
    for (const id of ids) writes.push({ op: "delete", collection: "log", doc_id: id, group });
  }

  const meta = readJson(join(dir, "meta", "state.json"), {});
  if (meta.main !== main)
    change(
      "meta",
      "state",
      { main, updatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z") },
      `main is ${main} on GitHub, the ledger says ${meta.main}`,
    );

  for (const line of findings) console.log(line);

  const versions = readJson(join(dir, "versions.json"), {});
  const missing = writes.flatMap((w) => {
    const key = `${w.collection}/${w.doc_id}`;
    return versions[key] ? [] : [key];
  });
  if (missing.length) {
    console.log(`versions.json has no version for ${missing.join(", ")}: add them and run again`);
    return 2;
  }

  mkdirSync(dataDir, { recursive: true });
  // A day's writes travel as one unit, every other write as a unit of its own.
  const units = new Map();
  for (const { data, group, ...entry } of writes) {
    entry.if_version = versions[`${entry.collection}/${entry.doc_id}`];
    if (data) {
      entry.file_path = join(dataDir, `${entry.collection}-${entry.doc_id}.json`);
      writeFileSync(entry.file_path, JSON.stringify(data));
    }
    const key = group ?? `${entry.collection}/${entry.doc_id}`;
    units.set(key, [...(units.get(key) ?? []), entry]);
  }
  const batches = [];
  for (const unit of units.values()) {
    if (unit.length > 50)
      throw new Error("one day's fold needs more than 50 writes; fold it by hand");
    const last = batches.at(-1);
    if (last && last.length + unit.length <= 50) last.push(...unit);
    else batches.push([...unit]);
  }

  writeFileSync(out, `${JSON.stringify({ batches }, null, 2)}\n`);
  console.log(
    findings.length
      ? `${findings.length} disagreements; ${writes.length} writes in ${batches.length} batch(es) in ${out}`
      : "the ledger agrees with GitHub",
  );
  return findings.length ? 1 : 0;
}
