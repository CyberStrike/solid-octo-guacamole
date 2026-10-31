import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { ao3Epub } from "../../../packages/epub/test/helpers";
import {
  bucketKeys,
  bucketText,
  deliver,
  existingWork,
  failingPut,
  gated,
  liveWork,
  newWorkId,
  parsedWork,
  pendingUpload,
  savedRows,
  setLease,
  uploadRow,
  watchedPuts,
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

  it("Successful job saves in order and goes live last", async () => {
    const workId = newWorkId();
    const id = await pendingUpload(ao3Epub({ workId }));
    const watched = watchedPuts(workId);
    const { handler } = watchedWorker({ bucket: watched.bucket });

    try {
      await deliver([{ upload_id: id }], { handler });
    } finally {
      await watched.close();
    }

    // R2 first: no work row existed while the fragment and the original were written.
    expect(watched.puts).toEqual([
      { key: `works/${workId}/${id}/1.html`, workExisted: false },
      { key: `originals/${id}.epub`, workExisted: false },
    ]);
    // Then the transaction. The order inside it can't be seen from outside; "Failure inside
    // the transaction rolls back" shows it is one transaction.
    const live = await liveWork(workId);
    expect(live?.work.status).toBe("live");
    expect(live?.version.r2_prefix).toBe(`works/${workId}/${id}/`);
    expect(live?.chapters.map((c) => c.r2_key)).toEqual([`works/${workId}/${id}/1.html`]);
    expect(live?.tags.map((t) => t.name)).toEqual([
      "General Audiences",
      "No Archive Warnings Apply",
      "Test Fandom",
      "Tag A",
      "Tag & B",
    ]);
    expect(await uploadRow(id)).toEqual({
      status: "live",
      lease_until: null,
      error_stage: null,
      error: null,
      work_id: live?.work.id,
    });
  });

  it("Failure before the transaction leaves nothing in Postgres", async () => {
    const tag = `Freeform ${crypto.randomUUID()}`;
    const work = parsedWork({
      freeforms: [tag],
      chapters: [
        { n: 1, title: "One", html: "<p>one</p>", words: 1 },
        { n: 2, title: "Two", html: "<p>two</p>", words: 1 },
      ],
    });
    const workId = Number(work.ao3WorkId);
    const id = await pendingUpload(ao3Epub({ workId }));
    // The fragments are written, then R2 fails on the original: the transaction never starts.
    const { handler } = watchedWorker({
      process: async () => work,
      bucket: failingPut(`originals/${id}.epub`),
    });

    const result = await deliver([{ upload_id: id }], { handler });

    expect(await savedRows(workId, id, [tag])).toEqual({ works: [], versions: [], tags: [] });
    expect(await bucketKeys(`works/${workId}/`)).toEqual([
      `works/${workId}/${id}/1.html`,
      `works/${workId}/${id}/2.html`,
    ]);
    // Worth a retry, as R2 being down is.
    expect((await uploadRow(id)).status).toBe("pending");
    expect(result.retryMessages.map((m) => m.msgId)).toEqual(["msg-0"]);

    await deliver([{ upload_id: id }], { attempts: 4, handler });

    expect(await savedRows(workId, id, [tag])).toEqual({ works: [], versions: [], tags: [] });
    const row = await uploadRow(id);
    expect(row.status).toBe("parse_failed");
    expect(row.error_stage).toBe("save");
    expect(row.error).toBe("Error");
  });

  it("Failure inside the transaction rolls back", async () => {
    const tag = `Freeform ${crypto.randomUUID()}`;
    // Two chapters numbered 1: the chapters insert fails on its primary key, after the work,
    // its authors, its tags and its version are written.
    const work = parsedWork({
      freeforms: [tag],
      chapters: [
        { n: 1, title: "One", html: "<p>one</p>", words: 1 },
        { n: 1, title: "Again", html: "<p>again</p>", words: 1 },
      ],
    });
    const workId = Number(work.ao3WorkId);
    const id = await pendingUpload(ao3Epub({ workId }));
    const { handler } = watchedWorker({ process: async () => work });

    const result = await deliver([{ upload_id: id }], { handler });

    expect(await savedRows(workId, id, [tag])).toEqual({ works: [], versions: [], tags: [] });
    // The file's own data broke a rule, as it would on every attempt: recorded at once.
    expect(await uploadRow(id)).toEqual({
      status: "parse_failed",
      lease_until: null,
      error_stage: "save",
      error: "save_rejected_23505",
      work_id: null,
    });
    expect(result.explicitAcks).toEqual(["msg-0"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("Failure inside the transaction leaves an existing work's current version unchanged", async () => {
    const existing = await existingWork({ ao3WorkId: newWorkId(), chapters: 2 });
    const before = await savedRows(existing.ao3WorkId, existing.uploadId);
    const id = await pendingUpload(ao3Epub({ workId: existing.ao3WorkId }));

    const result = await deliver([{ upload_id: id }]);

    expect(await savedRows(existing.ao3WorkId, existing.uploadId)).toEqual(before);
    expect(before.works[0]?.current_version_id).toBe(existing.versionId);
    const live = await liveWork(existing.ao3WorkId);
    expect(live?.chapters.map((c) => c.r2_key)).toEqual(existing.chapterKeys);
    expect((await savedRows(existing.ao3WorkId, id)).versions).toEqual([]);
    // Later uploads of a known work are I4's (#33): until then this one is refused.
    const row = await uploadRow(id);
    expect(row.status).toBe("parse_failed");
    expect(row.error_stage).toBe("save");
    expect(row.error).toBe("work_exists");
    expect(result.explicitAcks).toEqual(["msg-0"]);
  });

  it("acks without writing when another job takes the upload over during the save", async () => {
    const workId = newWorkId();
    const id = await pendingUpload(ao3Epub({ workId }));
    // SAFETY: the bucket's put below assigns it; null until then.
    let takenOver = null as Date | null;
    const { handler } = watchedWorker({
      // Another job claims the upload while this one writes R2, as after a lease ran out.
      bucket: (real) => ({
        get: real.get.bind(real),
        put: async (key, value, options) => {
          if (key.startsWith("originals/")) takenOver = await setLease(id, "1 hour");
          return real.put(key, value, options);
        },
      }),
    });

    const result = await deliver([{ upload_id: id }], { handler });

    expect((await savedRows(workId, id)).works).toEqual([]);
    const row = await uploadRow(id);
    expect(row.status).toBe("processing");
    expect(row.lease_until).toEqual(takenOver);
    expect(row.error).toBeNull();
    expect(result.explicitAcks).toEqual(["msg-0"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("records a work ID that doesn't fit, or a work with no chapters, at once", async () => {
    for (const [work, code] of [
      [parsedWork({ ao3WorkId: "2147483648" }), "bad_work_id"],
      [parsedWork({ chapters: [] }), "no_chapters"],
    ] as const) {
      const id = await pendingUpload(ao3Epub({ workId: newWorkId() }));
      const { handler } = watchedWorker({ process: async () => work });

      const result = await deliver([{ upload_id: id }], { handler });

      const row = await uploadRow(id);
      expect(row.status).toBe("parse_failed");
      expect(row.error_stage).toBe("save");
      expect(row.error).toBe(code);
      expect(result.explicitAcks).toEqual(["msg-0"]);
      expect(await bucketKeys(`originals/${id}`)).toEqual([]);
    }
  });

  it("Original file is kept", async () => {
    const epub = ao3Epub({ workId: newWorkId() });
    const id = await pendingUpload(epub);

    await deliver([{ upload_id: id }]);

    expect((await uploadRow(id)).status).toBe("live");
    const original = await env.BUCKET.get(`originals/${id}.epub`);
    // Sizes and digests, not bytes: a failing diff of a whole epub would print all of it.
    expect(original?.size).toBe(epub.byteLength);
    const digest = async (data: BufferSource) =>
      Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    expect(await digest((await original?.arrayBuffer()) ?? new ArrayBuffer(0))).toBe(
      await digest(epub),
    );
    // The upload's own object is left for the uploads/ expiry rule.
    expect(await env.BUCKET.head(`uploads/${id}.epub`)).not.toBeNull();
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
