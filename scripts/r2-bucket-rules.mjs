#!/usr/bin/env node
// Applies the R2 bucket's rules: the CORS rule that lets the upload page PUT a raw epub straight
// to a presigned URL (ARCHITECTURE, Ingestion pipeline, step 1), and the lifecycle rule that
// expires uploads/ after 7 days, so an upload whose /complete never comes deletes itself
// (ARCHITECTURE, Orphaned uploads). Then it prints the bucket's current rules, for the gate.
//
//   node scripts/r2-bucket-rules.mjs [--dry-run]
//
// The bucket is rarepair, the one apps/content/wrangler.jsonc binds. The operator runs this by
// hand, once, and again whenever a rule here changes; nothing deploys it. It needs wrangler's
// credentials: CLOUDFLARE_API_TOKEN (a token with Workers R2 Storage Write), or a
// `wrangler login`, and CLOUDFLARE_ACCOUNT_ID in the environment either way, since wrangler runs
// non-interactively and cannot ask which account. It never prints them.
//
// Both `set` calls pass --force, which skips wrangler's prompt. On `lifecycle set` it also skips
// R2 Data Catalog's check; the bucket has no Data Catalog, and enabling one means revisiting this.
//
// Every rule this bucket has lives here. `cors set` and `lifecycle set` replace the bucket's whole
// rule set, so a rule added any other way (the dashboard, `wrangler r2 bucket lifecycle add`) is
// deleted by the next run: add it to corsRules or lifecycleRules instead.
//
// The only rule that deletes objects is expire-uploads, on exactly uploads/. Every other lifecycle
// rule only aborts incomplete multipart uploads. The second rule, "Default Multipart Abort Rule",
// mirrors the one Cloudflare gives every new bucket (abort after 7 days, every prefix). It must be
// kept: without it, `lifecycle set` removes the default, and an unfinished multipart upload keeps
// its parts, and their storage bill, for good.
//
// --dry-run prints both rule sets, the wrangler commands and the wrangler it would run, and calls
// nothing.
// R2_BUCKET_RULES_WRANGLER, when set, is the wrangler script to run in place of the installed
// one; the tests point it at a stub.
// Exits 0 when the rules are applied and printed (or the dry run printed them), and 2 on a usage
// error or when wrangler fails: missing, unauthenticated, or refused. A run that fails part way is
// safe to repeat.
import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const BUCKET = "rarepair";
const DAY = 86400;

export function corsRules() {
  return {
    rules: [
      {
        allowed: {
          origins: ["https://rarepair.fans"],
          methods: ["PUT"],
          headers: ["Content-Type"],
        },
      },
    ],
  };
}

export function lifecycleRules() {
  return {
    rules: [
      {
        id: "expire-uploads",
        enabled: true,
        conditions: { prefix: "uploads/" },
        deleteObjectsTransition: { condition: { type: "Age", maxAge: 7 * DAY } },
      },
      // Cloudflare's default for new buckets, kept: lifecycle set would delete it.
      {
        id: "Default Multipart Abort Rule",
        enabled: true,
        conditions: { prefix: "" },
        abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: 7 * DAY } },
      },
    ],
  };
}

const root = fileURLToPath(new URL("..", import.meta.url));

// The wrangler apps/content declares, the workspace that binds the bucket, so the script runs the
// pinned version whether or not npm hoists it to the root. An empty override counts as none.
const wranglerBin = () =>
  process.env.R2_BUCKET_RULES_WRANGLER ||
  join(
    dirname(
      createRequire(join(root, "apps/content/package.json")).resolve("wrangler/package.json"),
    ),
    "bin/wrangler.js",
  );
const execFileAsync = promisify(execFile);

const setArgs = (kind, file) => ["r2", "bucket", kind, "set", BUCKET, "--file", file, "--force"];
const listArgs = (kind) => ["r2", "bucket", kind, "list", BUCKET];

async function main(dryRun) {
  const configs = { cors: corsRules(), lifecycle: lifecycleRules() };
  const kinds = Object.keys(configs);
  const bin = wranglerBin();
  if (dryRun) {
    const commands = [
      ...kinds.map((kind) => setArgs(kind, `<${kind}.json>`)),
      ...kinds.map((kind) => listArgs(kind)),
    ].map((args) => ["wrangler", ...args].join(" "));
    console.log(JSON.stringify({ ...configs, commands, wrangler: bin }, null, 2));
    return 0;
  }
  // From the repo root, which has no wrangler config, so none of the apps' configs is read.
  const wrangler = async (args) =>
    (await execFileAsync(process.execPath, [bin, ...args], { cwd: root, encoding: "utf8" })).stdout;
  const dir = mkdtempSync(join(tmpdir(), "r2-bucket-rules-"));
  try {
    for (const kind of kinds) {
      const file = join(dir, `${kind}.json`);
      writeFileSync(file, JSON.stringify(configs[kind]));
      await wrangler(setArgs(kind, file));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const kind of kinds) {
    console.log(await wrangler(listArgs(kind)));
  }
  return 0;
}

// Run as a script, not imported by the tests. Both paths are resolved, so a symlinked checkout
// still runs.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--dry-run")) {
    console.error("usage: node scripts/r2-bucket-rules.mjs [--dry-run]");
    process.exit(2);
  }
  try {
    process.exit(await main(args[0] === "--dry-run"));
  } catch (error) {
    console.error(`r2-bucket-rules: cannot apply: ${error.message ?? error}`);
    process.exit(2);
  }
}
