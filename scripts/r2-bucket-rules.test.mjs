// Tests for scripts/r2-bucket-rules.mjs, run with node:test: `npm run test:scripts`. Each
// scenario file is a top-level test and each case a subtest, awaited, as node:test's promises ask.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { lifecycleRules } from "./r2-bucket-rules.mjs";

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
