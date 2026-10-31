/** Used when `WAITLIST_FLOOR_MS` is missing or misspelt: a bad var never turns the floor off. */
export const DEFAULT_FLOOR_MS = 2000;

/** A floor var's value in milliseconds: a whole number, or else the default. */
export function floorOf(raw: string | undefined): number {
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : DEFAULT_FLOOR_MS;
}

/**
 * Runs `work` and answers with its result no sooner than `floorMs` after the call, whether it
 * returns or throws. The timer runs beside the work, not after it: workerd's clock only
 * advances at I/O, so a "time left" worked out from `Date.now()` could read zero after
 * CPU-only work. A floor can't hide a job slower than itself, so it must be set above the
 * slowest path.
 */
export async function padTo<T>(floorMs: number, work: () => Promise<T>): Promise<T> {
  const floor = new Promise<void>((resolve) => setTimeout(resolve, floorMs));
  const outcome = await Promise.allSettled([work(), floor]);
  const [job] = outcome;
  if (job.status === "rejected") throw job.reason;
  return job.value;
}
