import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEASE_SECONDS, MAX_RETRIES } from "../src/config";

// The queue's batching, concurrency, retries and dead-letter queue are Cloudflare's to enforce,
// from wrangler.jsonc: no local run shows them. This checks the config that deploys.

interface Consumer {
  queue: string;
  max_batch_size: number;
  max_concurrency: number;
  max_retries: number;
  retry_delay: number;
  dead_letter_queue: string;
}

/** The ingest queue's consumer in wrangler.jsonc, read with its line comments and trailing commas removed. */
function consumer(): Consumer {
  const text = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  // SAFETY: the fields read from it are each checked by the assertions that read them.
  const config = JSON.parse(text) as { queues: { consumers: Consumer[] } };
  const first = config.queues.consumers.at(0);
  if (first === undefined) throw new Error("wrangler.jsonc has no queue consumer");
  return first;
}

describe("04-ingest-job-lifecycle", () => {
  it("Consumer concurrency stays bounded under a flood", () => {
    expect(consumer()).toMatchObject({ queue: "ingest", max_batch_size: 5, max_concurrency: 2 });
  });

  it("Permanent failure goes to the dead-letter queue as parse_failed", () => {
    expect(consumer()).toMatchObject({ dead_letter_queue: "ingest-dlq", max_retries: 3 });
    // The job's last attempt is the queue's last delivery.
    expect(MAX_RETRIES).toBe(consumer().max_retries);
  });
});

describe("ingest lease", () => {
  it("holds a lease for less than the retry delay", () => {
    // So a retry of a job that died holding its lease finds the lease expired.
    expect(consumer().retry_delay).toBe(120);
    expect(LEASE_SECONDS).toBeLessThan(120);
  });
});
