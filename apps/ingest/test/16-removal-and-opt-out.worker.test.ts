import { describe, expect, it } from "vitest";
import { ao3Epub } from "../../../packages/epub/test/helpers";
import {
  addOptOut,
  deactivateOptOut,
  expectNotOptedOut,
  expectOptedOut,
  freshAo3WorkId,
  ingestEpub,
  ingestUpload,
  token,
  workExists,
} from "./helpers";

// Each case opts out a pseud of its own, with a token: an opt-out stays in the database every
// test file shares, and would reject other files' uploads. The opt-out holds the `pseud_norm`
// literal, so the test, not `normalizePseud`, says what matches.

/** Ingests a new work with the byline `pseuds`, and expects it `opted_out` with no work. */
async function expectRejected(...pseuds: string[]) {
  const workId = freshAo3WorkId();
  expectOptedOut(await ingestEpub(workId, ...pseuds));
  expect(await workExists(workId)).toBe(false);
}

/** Ingests a new work with the byline `pseuds`, and expects it not `opted_out`. */
const expectAccepted = async (...pseuds: string[]) =>
  expectNotOptedOut(await ingestEpub(freshAo3WorkId(), ...pseuds));

describe("16-removal-and-opt-out", () => {
  it("Opt-out blocks future uploads", async () => {
    // The epub's own byline, parsed for real: no override. A pseud of its own, since other
    // files' uploads run at the same time and carry the default byline.
    const pseud = `someone${token()}`;
    await addOptOut(pseud);
    const workId = freshAo3WorkId();

    expectOptedOut(await ingestUpload(ao3Epub({ workId, pseud })));
    expect(await workExists(workId)).toBe(false);
  });

  it("Opt-out matches the normalized pseud", async () => {
    const t = token();
    await addOptOut(`moon child ${t}`);

    // Fullwidth letters, which NFKC folds to ASCII.
    await expectRejected(`Ｍｏｏｎ Ｃｈｉｌｄ ${t}`);
  });

  it("Opt-out matches a pseud that differs only in case", async () => {
    const t = token();
    await addOptOut(`moon child ${t}`);

    await expectRejected(`moon CHILD ${t}`);
  });

  it("Opt-out matches a pseud with extra spaces", async () => {
    const t = token();
    await addOptOut(`moon child ${t}`);

    await expectRejected(`  Moon   Child ${t} `);
  });

  it("Opt-out does not match different punctuation", async () => {
    const t = token();
    await addOptOut(`moon child ${t}`);

    await expectAccepted(`Moon_Child ${t}`);
  });

  it("Mistaken opt-out can be reversed", async () => {
    const t = token();
    await deactivateOptOut(await addOptOut(`moon child ${t}`));

    await expectAccepted(`Moon Child ${t}`);
  });

  it("rejects a work when any one of its authors is opted out", async () => {
    const t = token();
    await addOptOut(`moon child ${t}`);

    await expectRejected(`Sun Child ${t}`, `Moon Child ${t}`);
  });

  it("never saves an upload whose opt-out check fails", async () => {
    // Postgres refuses a NUL in text, so the opt-out query itself fails.
    const { row, saved, result } = await ingestEpub(freshAo3WorkId(), `Moon\u0000Child ${token()}`);

    // Retried with the lease released, as for Postgres being down; never past the check.
    expect(saved).toEqual([]);
    expect(row.status).toBe("pending");
    expect(row.lease_until).toBeNull();
    expect(result.retryMessages).toEqual([{ msgId: "msg-0" }]);
  });
});
