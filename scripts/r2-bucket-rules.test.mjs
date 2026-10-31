// Tests for scripts/r2-bucket-rules.mjs, run with node:test: `npm run test:scripts`. Each
// scenario file is a top-level test and each case a subtest, awaited, as node:test's promises ask.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { corsRules, lifecycleRules } from "./r2-bucket-rules.mjs";

const script = fileURLToPath(new URL("r2-bucket-rules.mjs", import.meta.url));
const stub = fileURLToPath(new URL("test/wrangler-stub.mjs", import.meta.url));

// Runs the script with the stub as its wrangler. Returns the exit code, the output, and each call
// the stub saw, in order.
function run(args = [], { fail } = { fail: "" }) {
  const dir = mkdtempSync(join(tmpdir(), "r2-bucket-rules-test-"));
  const log = join(dir, "calls.jsonl");
  writeFileSync(log, "");
  try {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, R2_BUCKET_RULES_WRANGLER: stub, STUB_LOG: log, STUB_FAIL: fail },
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

const fileFor = (calls, command) =>
  calls.find((call) => call.args.join(" ").startsWith(command))?.file;

await test("02-upload-handshake", async (t) => {
  await t.test("Confirm is never called", () => {
    assert.deepEqual(lifecycleRules(), {
      rules: [
        {
          id: "expire-uploads",
          enabled: true,
          conditions: { prefix: "uploads/" },
          deleteObjectsTransition: { condition: { type: "Age", maxAge: 604800 } },
        },
      ],
    });
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

  await t.test("Expires nothing outside uploads/", () => {
    const { lifecycle } = JSON.parse(run(["--dry-run"]).stdout);
    assert.equal(lifecycle.rules.length, 1);
    assert.equal(lifecycle.rules[0].conditions.prefix, "uploads/");
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

await test("19-surge-controls-and-quotas", async (t) => {
  await t.test("Abandoned uploads expire", () => {
    const { code, calls } = run();
    assert.equal(code, 0);
    assert.deepEqual(fileFor(calls, "r2 bucket lifecycle set rarepair"), {
      rules: [
        {
          id: "expire-uploads",
          enabled: true,
          conditions: { prefix: "uploads/" },
          deleteObjectsTransition: { condition: { type: "Age", maxAge: 604800 } },
        },
      ],
    });
  });
});
