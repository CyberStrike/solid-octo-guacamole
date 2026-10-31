import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import type { Expected } from "./expected";

// Workers tests have no filesystem, so real fixtures are read here in Node and
// handed over as base64. A missing or empty directory provides nothing.
const FIXTURE_DIR = fileURLToPath(new URL("../../../fixtures/epubs/", import.meta.url));

export default function setup(project: TestProject): void {
  const fixtures: Record<string, string> = {};
  let names: string[] = [];
  try {
    names = readdirSync(FIXTURE_DIR).filter((n) => n.toLowerCase().endsWith(".epub"));
  } catch {
    names = [];
  }
  for (const name of names.sort()) {
    fixtures[name] = readFileSync(join(FIXTURE_DIR, name)).toString("base64");
  }
  project.provide("epubFixtures", fixtures);
  let text: string | null = null;
  try {
    text = readFileSync(join(FIXTURE_DIR, "expected.json"), "utf8");
  } catch (error) {
    // Only a missing file means "no expected values"; anything else fails the run.
    // SAFETY: readFileSync throws a Node system error, which carries a code.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // SAFETY: a local, git-ignored file shaped like expected.example.json. A malformed
  // file throws here (JSON.parse) instead of silently skipping the checks.
  const expected = text === null ? {} : (JSON.parse(text) as Record<string, Expected>);
  project.provide("epubExpected", expected);
}
