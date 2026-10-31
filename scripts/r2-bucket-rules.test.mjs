// Tests for scripts/r2-bucket-rules.mjs, run with node:test: `npm run test:scripts`. Each
// scenario file is a top-level test and each case a subtest, awaited, as node:test's promises ask.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { corsRules, lifecycleRules } from "./r2-bucket-rules.mjs";

const script = fileURLToPath(new URL("r2-bucket-rules.mjs", import.meta.url));
const stub = fileURLToPath(new URL("test/wrangler-stub.mjs", import.meta.url));
const root = dirname(dirname(script));

// Runs the script with the stub as its wrangler (or with `wrangler` as the override, "" for none).
// The stub fails a call whose arguments start with `fail`. Returns the exit code, the output, and
// each call the stub saw, in order.
function run(args = [], { fail = "", wrangler = stub } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "r2-bucket-rules-test-"));
  const log = join(dir, "calls.jsonl");
  writeFileSync(log, "");
  try {
    // From outside the repo, as an operator in any directory would run it.
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, R2_BUCKET_RULES_WRANGLER: wrangler, STUB_LOG: log, STUB_FAIL: fail },
    });
    const calls = readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { code: result.status, stdout: result.stdout, stderr: result.stderr, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The scenarios' THEN, as a rule: everything under uploads/ is deleted 604800 s (7 days) after
// it was written.
const expireUploads = {
  id: "expire-uploads",
  enabled: true,
  conditions: { prefix: "uploads/" },
  deleteObjectsTransition: { condition: { type: "Age", maxAge: 604800 } },
};

// The rule R2 gives a new bucket, which a lifecycle set would otherwise delete: abort incomplete
// multipart uploads, on every prefix, 7 days after they start.
const defaultMultipartAbort = {
  id: "Default Multipart Abort Rule",
  enabled: true,
  conditions: { prefix: "" },
  abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: 604800 } },
};

// The keys of a rule that only aborts incomplete multipart uploads: no delete or transition.
const abortOnly = ["abortMultipartUploadsTransition", "conditions", "enabled", "id"];

const appliedLifecycle = () => {
  const { code, calls } = run();
  assert.equal(code, 0);
  return fileFor(calls, "r2 bucket lifecycle set rarepair");
};

const fileFor = (calls, command) =>
  calls.find((call) => call.args.join(" ").startsWith(command))?.file;

await test("02-upload-handshake", async (t) => {
  await t.test("Confirm is never called", () => {
    const { rules } = appliedLifecycle();
    assert.deepEqual(
      rules.find((rule) => rule.id === "expire-uploads"),
      expireUploads,
    );
  });
});

await test("CORS for the app origin", async (t) => {
  await t.test("Browsers on rarepair.fans may PUT an upload with its Content-Type", () => {
    const { code, calls } = run();
    assert.equal(code, 0);
    assert.deepEqual(fileFor(calls, "r2 bucket cors set rarepair"), {
      rules: [
        {
          allowed: {
            origins: ["https://rarepair.fans"],
            methods: ["PUT"],
            headers: ["Content-Type"],
          },
        },
      ],
    });
  });
});

await test("Applying the bucket rules", async (t) => {
  await t.test("Replaces both rule sets, then prints the bucket's current rules", () => {
    const { code, stdout, calls } = run();
    assert.equal(code, 0);
    assert.deepEqual(
      calls.map(({ args }) => args.map((arg, i) => (args[i - 1] === "--file" ? "<file>" : arg))),
      [
        ["r2", "bucket", "cors", "set", "rarepair", "--file", "<file>", "--force"],
        ["r2", "bucket", "lifecycle", "set", "rarepair", "--file", "<file>", "--force"],
        ["r2", "bucket", "cors", "list", "rarepair"],
        ["r2", "bucket", "lifecycle", "list", "rarepair"],
      ],
    );
    assert.match(stdout, /stub ran: r2 bucket cors list rarepair/);
    assert.match(stdout, /stub ran: r2 bucket lifecycle list rarepair/);
    // From the repo root, so no app's wrangler config, wherever the operator stands, picks the
    // account or breaks the run.
    for (const call of calls) assert.equal(call.cwd, root);
  });
});

await test("A dry run", async (t) => {
  await t.test("Prints both rule sets and the commands, and calls nothing", () => {
    const { code, stdout, calls } = run(["--dry-run"]);
    assert.equal(code, 0);
    assert.equal(calls.length, 0);
    const printed = JSON.parse(stdout);
    assert.deepEqual(printed.cors, corsRules());
    assert.deepEqual(printed.lifecycle, lifecycleRules());
    assert.deepEqual(printed.commands, [
      "wrangler r2 bucket cors set rarepair --file <cors.json> --force",
      "wrangler r2 bucket lifecycle set rarepair --file <lifecycle.json> --force",
      "wrangler r2 bucket cors list rarepair",
      "wrangler r2 bucket lifecycle list rarepair",
    ]);
  });
});

await test("The bucket's lifecycle rules", async (t) => {
  const { rules } = appliedLifecycle();

  await t.test("Keep R2's default multipart abort rule", () => {
    assert.deepEqual(rules, [expireUploads, defaultMultipartAbort]);
  });

  await t.test("Only expire-uploads deletes objects", () => {
    const deleting = rules.filter((rule) => Object.keys(rule).some((k) => !abortOnly.includes(k)));
    assert.deepEqual(
      deleting.map((rule) => rule.id),
      ["expire-uploads"],
    );
  });

  await t.test("Every other rule only aborts incomplete multipart uploads", () => {
    const others = rules.filter((rule) => rule.id !== "expire-uploads");
    for (const rule of others) assert.deepEqual(Object.keys(rule).toSorted(), abortOnly);
  });

  await t.test("expire-uploads expires exactly uploads/", () => {
    const rule = rules.find((r) => r.id === "expire-uploads");
    assert.equal(rule?.conditions.prefix, "uploads/");
  });
});

await test("A usage error", async (t) => {
  await t.test("Exits 2 on an unknown argument and calls nothing", () => {
    const { code, stderr, calls } = run(["--bucket", "other"]);
    assert.equal(code, 2);
    assert.match(stderr, /usage: node scripts\/r2-bucket-rules\.mjs \[--dry-run\]/);
    assert.equal(calls.length, 0);
  });
});

await test("When wrangler fails", async (t) => {
  await t.test("Exits 2 with wrangler's error and runs nothing after it", () => {
    const { code, stderr, calls } = run([], { fail: "r2 bucket cors set" });
    assert.equal(code, 2);
    assert.match(stderr, /stub: r2 bucket cors set failed/);
    assert.equal(calls.length, 1);
  });
});

await test("When wrangler fails part way", async (t) => {
  await t.test("Exits 2, lists nothing, and leaves no rule file behind", () => {
    const { code, calls } = run([], { fail: "r2 bucket lifecycle set" });
    assert.equal(code, 2);
    assert.deepEqual(
      calls.map(({ args }) => args.slice(2, 4).join(" ")),
      ["cors set", "lifecycle set"],
    );
    for (const { args } of calls) assert.equal(existsSync(args[args.indexOf("--file") + 1]), false);
  });
});

await test("The installed wrangler", async (t) => {
  await t.test("Is the one apps/content pins, when no override is set", () => {
    const { code, stdout } = run(["--dry-run"], { wrangler: "" });
    assert.equal(code, 0);
    const { wrangler } = JSON.parse(stdout);
    assert.ok(existsSync(wrangler), wrangler);
    const manifest = join(dirname(dirname(wrangler)), "package.json");
    assert.equal(JSON.parse(readFileSync(manifest, "utf8")).version, "4.156.0");
  });
});

await test("19-surge-controls-and-quotas", async (t) => {
  await t.test("Abandoned uploads expire", () => {
    const { rules } = appliedLifecycle();
    assert.deepEqual(
      rules.find((rule) => rule.id === "expire-uploads"),
      expireUploads,
    );
  });
});
