import { describe, expect, it } from "vitest";
import { ao3Epub } from "../../../packages/epub/test/helpers";
import { deliver, gated, pendingUpload, setLease, uploadRow, watchedWorker } from "./helpers";

describe("04-ingest-job-lifecycle", () => {
  it("Lease claims a pending upload", async () => {
    const id = await pendingUpload(ao3Epub());

    const result = await deliver([{ upload_id: id }]);

    const row = await uploadRow(id);
    expect(row.status).toBe("processing");
    expect(row.lease_until!.getTime()).toBeGreaterThan(Date.now());
    expect(result.explicitAcks).toEqual(["msg-0"]);
  });

  it("Duplicate delivery does not double-process", async () => {
    const id = await pendingUpload(ao3Epub());
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
    const epub = ao3Epub();
    const id = await pendingUpload(epub);
    await setLease(id, "-1 minute");
    const { handler, parsed } = watchedWorker();

    const result = await deliver([{ upload_id: id }], { handler });

    expect(parsed).toEqual([epub]);
    const row = await uploadRow(id);
    expect(row.status).toBe("processing");
    expect(row.lease_until!.getTime()).toBeGreaterThan(Date.now());
    expect(result.explicitAcks).toEqual(["msg-0"]);
  });

  it("Concurrent deliveries claim the lease once", async () => {
    const id = await pendingUpload(ao3Epub());
    const gate = gated();
    const first = watchedWorker({ process: gate.process });
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
});
