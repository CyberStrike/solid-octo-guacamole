import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { ao3Epub } from "../../../packages/epub/test/helpers";
import {
  bucketKeys,
  bucketText,
  deliver,
  failingPut,
  gated,
  newWorkId,
  pendingUpload,
  setLease,
  uploadRow,
  watchedWorker,
} from "./helpers";
import type { Steps } from "../src/worker";

// The lease cases look at the upload while its job holds it: their save leaves it `processing`.
const holding: Partial<Steps> = { save: async () => {} };

describe("04-ingest-job-lifecycle", () => {
  it("Retry overwrites only its own output", async () => {
    const workId = newWorkId();
    const id = await pendingUpload(ao3Epub({ workId }));
    const own = `works/${workId}/${id}/1.html`;
    const others = `works/${workId}/${crypto.randomUUID()}/1.html`;
    await env.BUCKET.put(own, "stale output of an earlier attempt");
    await env.BUCKET.put(others, "another upload's fragment");
    // The first attempt writes the fragments, then fails before the transaction.
    const { handler } = watchedWorker({ bucket: failingPut(`originals/${id}.epub`) });
    const first = await deliver([{ upload_id: id }], { handler });
    expect(first.retryMessages.map((m) => m.msgId)).toEqual(["msg-0"]);

    const retry = await deliver([{ upload_id: id }], { attempts: 2 });

    expect(await bucketText(own)).toContain("marker-only-chapter text.");
    expect(await bucketText(others)).toBe("another upload's fragment");
    expect(await bucketKeys(`works/${workId}/`)).toEqual([own, others].sort());
    expect((await uploadRow(id)).status).toBe("live");
    expect(retry.explicitAcks).toEqual(["msg-0"]);
  });

  it("Lease claims a pending upload", async () => {
    const id = await pendingUpload(ao3Epub({ workId: newWorkId() }));
    const { handler } = watchedWorker(holding);

    const result = await deliver([{ upload_id: id }], { handler });

    const row = await uploadRow(id);
    expect(row.status).toBe("processing");
    expect(row.lease_until!.getTime()).toBeGreaterThan(Date.now());
    expect(result.explicitAcks).toEqual(["msg-0"]);
  });

  it("Duplicate delivery does not double-process", async () => {
    const id = await pendingUpload(ao3Epub({ workId: newWorkId() }));
    const leaseUntil = await setLease(id, "1 hour");
    const { handler, parsed } = watchedWorker();

    const result = await deliver([{ upload_id: id }], { handler });

    expect(parsed).toEqual([]);
    const row = await uploadRow(id);
    expect(row.status).toBe("processing");
    expect(row.lease_until).toEqual(leaseUntil);
    expect(row.error_stage).toBeNull();
    expect(result.explicitAcks).toEqual(["msg-0"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("Expired lease can be re-claimed", async () => {
    const epub = ao3Epub({ workId: newWorkId() });
    const id = await pendingUpload(epub);
    await setLease(id, "-1 minute");
    const { handler, parsed } = watchedWorker(holding);

    const result = await deliver([{ upload_id: id }], { handler });

    expect(parsed).toEqual([epub]);
    const row = await uploadRow(id);
    expect(row.status).toBe("processing");
    expect(row.lease_until!.getTime()).toBeGreaterThan(Date.now());
    expect(result.explicitAcks).toEqual(["msg-0"]);
  });

  it("Concurrent deliveries claim the lease once", async () => {
    const id = await pendingUpload(ao3Epub({ workId: newWorkId() }));
    const gate = gated();
    const first = watchedWorker({ ...holding, process: gate.process });
    const second = watchedWorker();

    // Two invocations in flight at once, each with its own connection to Postgres. The first
    // is held inside its job while the second runs, so only one sends at a time: the test
    // database's socket can interleave two clients' queries (vitest.config.ts).
    const running = deliver([{ upload_id: id }], { handler: first.handler });
    await gate.entered;
    const secondResult = await deliver([{ upload_id: id }], { handler: second.handler });
    gate.release();
    const firstResult = await running;

    expect(first.parsed).toHaveLength(1);
    expect(second.parsed).toHaveLength(0);
    expect((await uploadRow(id)).status).toBe("processing");
    expect(firstResult.explicitAcks).toEqual(["msg-0"]);
    expect(secondResult.explicitAcks).toEqual(["msg-0"]);
  });

  it("Permanent failure goes to the dead-letter queue as parse_failed", async () => {
    const id = await pendingUpload(ao3Epub({ workId: newWorkId() }));
    const { handler } = watchedWorker({
      process: async () => {
        throw new TypeError("injected failure at the process stage");
      },
    });

    // The last delivery: max_retries (3) retries after the first.
    const result = await deliver([{ upload_id: id }], { attempts: 4, handler });

    const row = await uploadRow(id);
    expect(row.status).toBe("parse_failed");
    expect(row.error_stage).toBe("process");
    expect(row.error).toBe("TypeError");
    expect(row.lease_until).toBeNull();
    // Retried, not acked, so the queue moves it to its dead-letter queue (wrangler.jsonc).
    expect(result.retryMessages.map((m) => m.msgId)).toEqual(["msg-0"]);
    expect(result.explicitAcks).toEqual([]);
  });

  it("records the stage that failed for good", async () => {
    const id = await pendingUpload(ao3Epub({ workId: newWorkId() }));
    const { handler } = watchedWorker({
      save: async () => {
        throw new RangeError("injected failure at the save stage");
      },
    });

    await deliver([{ upload_id: id }], { attempts: 4, handler });

    const row = await uploadRow(id);
    expect(row.status).toBe("parse_failed");
    expect(row.error_stage).toBe("save");
    expect(row.error).toBe("RangeError");
  });

  it("logs a failure's class name, never its message", async () => {
    const id = await pendingUpload(ao3Epub({ workId: newWorkId() }));
    const { handler } = watchedWorker({
      process: async () => {
        throw new TypeError("text quoted from the file: marker-in-message");
      },
    });
    const lines: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(JSON.stringify(args));
      });
    }

    try {
      await deliver([{ upload_id: id }], { attempts: 4, handler });
    } finally {
      vi.restoreAllMocks();
    }

    const text = lines.join("\n");
    expect(text).toContain(id);
    expect(text).not.toContain("marker-in-message");
    expect((await uploadRow(id)).error).toBe("TypeError");
  });

  it("releases the lease and retries a failure with attempts left", async () => {
    const id = await pendingUpload(ao3Epub({ workId: newWorkId() }));
    const { handler } = watchedWorker({
      process: async () => {
        throw new Error("injected transient failure");
      },
    });

    const result = await deliver([{ upload_id: id }], { attempts: 3, handler });

    const row = await uploadRow(id);
    expect(row.status).toBe("pending");
    expect(row.lease_until).toBeNull();
    expect(row.error_stage).toBeNull();
    expect(result.retryMessages.map((m) => m.msgId)).toEqual(["msg-0"]);
    expect(result.explicitAcks).toEqual([]);
  });

  it("Consumer concurrency stays bounded under a flood", async () => {
    // The platform cap is max_concurrency in wrangler.jsonc (test/queue-config.node.test.ts).
    // Inside one invocation, a full batch runs one job at a time, and none fails for waiting.
    // One after another: the test database takes one client's queries at a time.
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await pendingUpload(ao3Epub({ workId: newWorkId() })));
    const gate = gated();
    const { handler } = watchedWorker({ process: gate.process });

    const running = deliver(
      ids.map((id) => ({ upload_id: id })),
      { handler },
    );
    await gate.entered;
    gate.release();
    const result = await running;

    expect(gate.counts.most).toBe(1);
    expect(result.explicitAcks.sort()).toEqual(["msg-0", "msg-1", "msg-2", "msg-3", "msg-4"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("acks a message that names no upload, and runs the rest of its batch", async () => {
    const id = await pendingUpload(ao3Epub({ workId: newWorkId() }));

    const result = await deliver([{ upload: id }, "not an object", { upload_id: id }]);

    expect((await uploadRow(id)).status).toBe("live");
    expect(result.explicitAcks.sort()).toEqual(["msg-0", "msg-1", "msg-2"]);
  });

  it("records parse_failed at the read stage, without a retry, when the object is gone", async () => {
    // As for a message redriven after the 7-day expiry of uploads/ (#176).
    const id = await pendingUpload(null);

    const result = await deliver([{ upload_id: id }]);

    const row = await uploadRow(id);
    expect(row.status).toBe("parse_failed");
    expect(row.error_stage).toBe("read");
    expect(row.error).toBe("object_missing");
    expect(row.lease_until).toBeNull();
    expect(result.explicitAcks).toEqual(["msg-0"]);
    expect(result.retryMessages).toEqual([]);
  });
});
