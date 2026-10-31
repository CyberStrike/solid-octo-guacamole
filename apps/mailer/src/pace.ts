// Spacing for the email-bulk consumer. Queues has no rate limit of its own: max_concurrency 1
// stops two batches overlapping, but a backlog is still handed over back to back. So the consumer
// holds its invocation open until the interval since its send began has passed, and the next
// batch starts no sooner (ARCHITECTURE, Auth, Email: Two queues).

// Used when BULK_INTERVAL_SECONDS is missing or not a number: a misspelt setting must not turn
// the pacing off.
const DEFAULT_INTERVAL_MS = 10_000;

/** The pause between bulk batches, in ms, from the BULK_INTERVAL_SECONDS var. */
export function bulkIntervalMs(seconds: string | undefined): number {
  if (seconds === undefined || seconds.trim() === "") return DEFAULT_INTERVAL_MS;
  const value = Number(seconds);
  return Number.isFinite(value) && value >= 0 ? value * 1000 : DEFAULT_INTERVAL_MS;
}

/** Waits out what is left of `intervalMs` since `startedAt`; nothing if the send was slower. */
export async function pace(
  startedAt: number,
  intervalMs: number,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const remaining = startedAt + intervalMs - now();
  if (remaining > 0) await sleep(remaining);
}
