import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// wrangler.jsonc without its comments and trailing commas: strings are kept whole, so a `//`
// inside one survives.
function readConfig(): Record<string, unknown> {
  const text = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const json = text
    .replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*/g, (m) => (m.startsWith('"') ? m : ""))
    .replace(/,(\s*[}\]])/g, "$1");
  // SAFETY: JSON.parse returns the file's top-level object, which is what the tests read from.
  return JSON.parse(json) as Record<string, unknown>;
}

describe("22-waitlist", () => {
  it("The mailer consumes email-bulk with email-bulk-dlq as its dead-letter queue", () => {
    // SAFETY: the config's `queues.consumers` is an array of consumer objects.
    const consumers = (readConfig().queues as { consumers: Record<string, unknown>[] }).consumers;

    const bulk = consumers.find((c) => c.queue === "email-bulk");
    expect(bulk).toMatchObject({
      dead_letter_queue: "email-bulk-dlq",
      max_concurrency: 1,
      max_retries: 2,
      retry_delay: 300,
    });
    // The sign-in consumer is as it was.
    expect(consumers.find((c) => c.queue === "email")).toMatchObject({
      max_batch_size: 100,
      max_batch_timeout: 5,
      max_concurrency: 1,
      max_retries: 2,
      retry_delay: 60,
      dead_letter_queue: "email-dlq",
    });
  });

  it("The mailer still has no database, KV or R2 binding", () => {
    const keys = Object.keys(readConfig());

    for (const binding of ["hyperdrive", "kv_namespaces", "r2_buckets", "d1_databases"]) {
      expect(keys).not.toContain(binding);
    }
  });
});
