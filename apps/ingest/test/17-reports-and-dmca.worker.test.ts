import { describe, expect, it } from "vitest";
import { ao3Epub } from "../../../packages/epub/test/helpers";
import {
  addTakedown,
  deliver,
  freshAo3WorkId,
  pendingUpload,
  savingWorker,
  seededWork,
  uploadRow,
} from "./helpers";

// Each case seeds a work with an AO3 work ID of its own: a takedown stays in the database every
// test file shares. The scenario's 12345 stands for any ID.

/** A work with a DMCA notice in `notice` status, then a new upload of it, ingested. */
async function reuploadAfterNotice(work: "live" | "removed", notice: string) {
  const workId = freshAo3WorkId();
  const seeded = await seededWork({ ao3WorkId: workId, status: work });
  await addTakedown(seeded.workId, notice);
  const id = await pendingUpload(ao3Epub({ workId }));
  const worker = savingWorker();
  const result = await deliver([{ upload_id: id }], { handler: worker.handler });
  return { id, row: await uploadRow(id), saved: worker.saved, result };
}

describe("17-reports-and-dmca", () => {
  it("Taken-down work cannot be re-uploaded", async () => {
    const { row, saved, result } = await reuploadAfterNotice("removed", "removed");

    expect(row.status).toBe("opted_out");
    expect(row.error).toBe("opted_out");
    expect(row.work_id).toBeNull();
    expect(row.lease_until).toBeNull();
    expect(saved).toEqual([]);
    expect(result.explicitAcks).toEqual(["msg-0"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("Pending DMCA notice does not block an upload", async () => {
    const { id, row, saved } = await reuploadAfterNotice("live", "pending");

    expect(row.status).not.toBe("opted_out");
    // On to the save step, where the versioning rules apply (I2, #32).
    expect(saved).toEqual([id]);
  });

  it("does not block a removed work whose notice no moderator acted on", async () => {
    // Removed for another reason: only a notice that removed the work lists it.
    const { id, row, saved } = await reuploadAfterNotice("removed", "pending");

    expect(row.status).not.toBe("opted_out");
    expect(saved).toEqual([id]);
  });
});
