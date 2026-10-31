#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    ],
  };
}

const wranglerBin = () =>
  process.env.R2_BUCKET_RULES_WRANGLER ??
  join(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin/wrangler.js");

async function main() {
  const wrangler = async (args) =>
    (
      await promisify(execFile)(process.execPath, [wranglerBin(), ...args], {
        encoding: "utf8",
      })
    ).stdout;
  const configs = { cors: corsRules(), lifecycle: lifecycleRules() };
  const dir = mkdtempSync(join(tmpdir(), "r2-bucket-rules-"));
  try {
    for (const [kind, config] of Object.entries(configs)) {
      const file = join(dir, `${kind}.json`);
      writeFileSync(file, JSON.stringify(config));
      await wrangler(["r2", "bucket", kind, "set", BUCKET, "--file", file, "--force"]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const kind of Object.keys(configs)) {
    console.log(await wrangler(["r2", "bucket", kind, "list", BUCKET]));
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`r2-bucket-rules: cannot apply: ${error.message ?? error}`);
    process.exit(2);
  }
}
