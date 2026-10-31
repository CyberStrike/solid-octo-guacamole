import { describe, it } from "vitest";
import { TAKEDOWN_REMOVED } from "../src/lists";
import { addTakedown, expectNotOptedOut, expectOptedOut, ingestEpub, seededWork } from "./helpers";

// Each case seeds a work with an AO3 work ID of its own: a takedown stays in the database every
// test file shares. The scenario's 12345 stands for any ID.

/** A work with a DMCA notice in `notice` status, then a new upload of it, ingested. */
async function reuploadAfterNotice(work: "live" | "removed", notice: string) {
  const seeded = await seededWork({ status: work });
  await addTakedown(seeded.workId, notice);
  return ingestEpub(seeded.ao3WorkId);
}

describe("17-reports-and-dmca", () => {
  it("Taken-down work cannot be re-uploaded", async () => {
    expectOptedOut(await reuploadAfterNotice("removed", TAKEDOWN_REMOVED));
  });

  it("Pending DMCA notice does not block an upload", async () => {
    // Saved means on to the save step, where the versioning rules apply (I2, #32).
    expectNotOptedOut(await reuploadAfterNotice("live", "pending"));
  });

  it("does not block a removed work whose notice no moderator acted on", async () => {
    // Removed for another reason: only a notice that removed the work lists it.
    expectNotOptedOut(await reuploadAfterNotice("removed", "pending"));
  });
});
