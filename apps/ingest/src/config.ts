// The job's timings, which must agree with the queue consumer's in wrangler.jsonc
// (test/queue-config.node.test.ts checks them).

/** Mirrors `max_retries`: a message is delivered up to this many times after the first. */
export const MAX_RETRIES = 3;

/** How long a job holds its upload. Under `retry_delay`, so a retry finds a dead job's lease expired. */
export const LEASE_SECONDS = 60;
