import { describe, expect, it } from "vitest";
import { ao3Epub } from "../../../packages/epub/test/helpers";
import {
  addOptOut,
  deactivateOptOut,
  deliver,
  freshAo3WorkId,
  pendingUpload,
  savingWorker,
  token,
  uploadRow,
  workExists,
} from "./helpers";

// Each case opts out a pseud of its own, with a token: an opt-out stays in the database every
// test file shares, and would reject other files' uploads. The opt-out holds the `pseud_norm`
// literal, so the test, not `normalizePseud`, says what matches.

/** Ingests an epub with the byline `pseuds`, and returns its row and what was saved. */
async function ingestBy(...pseuds: string[]) {
  const workId = freshAo3WorkId();
  const id = await pendingUpload(ao3Epub({ workId }));
  const worker = savingWorker(...pseuds);
  const result = await deliver([{ upload_id: id }], { handler: worker.handler });
  return { id, workId, row: await uploadRow(id), saved: worker.saved, result };
}

/** Expects the upload rejected as `opted_out`: acked, with no work and nothing saved. */
async function expectOptedOut({
  row,
  saved,
  result,
  workId,
}: Awaited<ReturnType<typeof ingestBy>>) {
  expect(row.status).toBe("opted_out");
  expect(row.error).toBe("opted_out");
  expect(row.work_id).toBeNull();
  expect(row.lease_until).toBeNull();
  expect(saved).toEqual([]);
  expect(await workExists(workId)).toBe(false);
  expect(result.explicitAcks).toEqual(["msg-0"]);
  expect(result.retryMessages).toEqual([]);
}

/** Expects the upload not rejected as `opted_out`: the job went on to save it. */
function expectNotOptedOut({ id, row, saved }: Awaited<ReturnType<typeof ingestBy>>) {
  expect(row.status).not.toBe("opted_out");
  expect(saved).toEqual([id]);
}

describe("16-removal-and-opt-out", () => {
  it("Opt-out blocks future uploads", async () => {
    // The synthetic epub's own byline, `someone`, parsed for real: no override. Reversed at
    // the end, since every other file's uploads carry it too.
    const optOut = await addOptOut("someone");
    try {
      await expectOptedOut(await ingestBy());
    } finally {
      await deactivateOptOut(optOut);
    }
  });

  it("Opt-out matches the normalized pseud", async () => {
    const t = token();
    await addOptOut(`moon child ${t}`);

    // Fullwidth letters, which NFKC folds to ASCII.
    await expectOptedOut(await ingestBy(`Ｍｏｏｎ Ｃｈｉｌｄ ${t}`));
  });

  it("Opt-out matches a pseud that differs only in case", async () => {
    const t = token();
    await addOptOut(`moon child ${t}`);

    await expectOptedOut(await ingestBy(`moon CHILD ${t}`));
  });

  it("Opt-out matches a pseud with extra spaces", async () => {
    const t = token();
    await addOptOut(`moon child ${t}`);

    await expectOptedOut(await ingestBy(`  Moon   Child ${t} `));
  });

  it("Opt-out does not match different punctuation", async () => {
    const t = token();
    await addOptOut(`moon child ${t}`);

    expectNotOptedOut(await ingestBy(`Moon_Child ${t}`));
  });

  it("Mistaken opt-out can be reversed", async () => {
    const t = token();
    const optOut = await addOptOut(`moon child ${t}`);
    await deactivateOptOut(optOut);

    expectNotOptedOut(await ingestBy(`Moon Child ${t}`));
  });

  it("rejects a work when any one of its authors is opted out", async () => {
    const t = token();
    await addOptOut(`moon child ${t}`);

    await expectOptedOut(await ingestBy(`Sun Child ${t}`, `Moon Child ${t}`));
  });

  it("never saves an upload whose opt-out check fails", async () => {
    // Postgres refuses a NUL in text, so the opt-out query itself fails.
    const { row, saved, result } = await ingestBy(`Moon\u0000Child ${token()}`);

    // Retried with the lease released, as for Postgres being down; never past the check.
    expect(saved).toEqual([]);
    expect(row.status).toBe("pending");
    expect(row.lease_until).toBeNull();
    expect(result.retryMessages).toEqual([{ msgId: "msg-0" }]);
  });
});
