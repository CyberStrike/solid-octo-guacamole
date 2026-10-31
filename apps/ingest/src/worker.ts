import { createDb } from "@archive/db";
import { processEpub } from "@archive/epub";
import { runJob, type JobDeps } from "./job";
import { parseMessage } from "./message";

export interface Env {
  HYPERDRIVE: Hyperdrive;
  BUCKET: R2Bucket;
}

/** The job's steps a test may replace, to fail one stage or to watch it. */
export type Steps = Pick<JobDeps, "process" | "save">;

const DEFAULT_STEPS: Steps = {
  process: (bytes) => processEpub(bytes),
  // Saving the work is I2's (#32). Until then a parsed upload stays `processing`, and its
  // lease runs out with nothing to redeliver it. Nothing deploys before I2.
  save: async () => {},
};

/** The queue handler, with `steps` over the real ones. */
export function ingestWorker(steps: Partial<Steps> = {}) {
  return {
    async queue(batch, env, ctx) {
      const db = createDb({ connectionString: env.HYPERDRIVE.connectionString });
      const deps: JobDeps = { db, bucket: env.BUCKET, ...DEFAULT_STEPS, ...steps };
      try {
        for (const message of batch.messages) {
          const parsed = parseMessage(message.body);
          if (parsed === null) {
            message.ack();
            continue;
          }
          const verdict = await runJob(deps, parsed.uploadId);
          if (verdict === "ack") message.ack();
          else message.retry();
        }
      } finally {
        ctx.waitUntil(db.destroy());
      }
    },
  } satisfies ExportedHandler<Env>;
}

export default ingestWorker();
