import { describe, expect, it } from "vitest";
import { zipEntries } from "../../../packages/epub/test/helpers";
import { TAKEDOWN_REMOVED } from "../src/lists";
import {
  addOptOut,
  addTakedown,
  deliver,
  expectOptedOut,
  freshAo3WorkId,
  ingestEpub,
  pendingUpload,
  seededWork,
  token,
  uploadRow,
  workExists,
} from "./helpers";

/** A well-formed epub with no AO3 preface, carrying `metadata` in its OPF. Synthetic text. */
const prefacelessEpub = (metadata: string) =>
  zipEntries({
    "META-INF/container.xml": `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
    "OEBPS/content.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
        <dc:title>Elsewhere</dc:title><dc:creator>someone</dc:creator>
        ${metadata}
      </metadata>
      <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="c1"/></spine>
    </package>`,
    "OEBPS/c1.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>plain text</p></body></html>`,
  });

/** Ingests the epub, and expects it rejected as `not_ao3` with no work. */
async function expectNotAo3(epub: Uint8Array) {
  const id = await pendingUpload(epub);

  const result = await deliver([{ upload_id: id }]);

  const row = await uploadRow(id);
  expect(row.status).toBe("not_ao3");
  expect(row.work_id).toBeNull();
  expect(result.explicitAcks).toEqual(["msg-0"]);
  expect(result.retryMessages).toEqual([]);
}

describe("06-ao3-preface-and-chapters", () => {
  it("AO3 URL only in the OPF is rejected as not_ao3", async () => {
    await expectNotAo3(
      prefacelessEpub(`<dc:identifier>https://archiveofourown.org/works/5</dc:identifier>`),
    );
  });

  it("Missing AO3 URL is rejected as not_ao3", async () => {
    await expectNotAo3(
      prefacelessEpub(`<dc:identifier>urn:isbn:9780000000002</dc:identifier>
        <dc:publisher>A Commercial Press</dc:publisher>`),
    );
  });

  it("FanFicFare epub is rejected in v1", async () => {
    await expectNotAo3(
      prefacelessEpub(`<dc:source>https://archiveofourown.org/works/6</dc:source>
        <dc:contributor opf:role="bkp">FanFicFare [https://github.com/JimmXinu/FanFicFare]</dc:contributor>`),
    );
  });
});

// Opt-outs and takedowns (I5, #34), in a block of their own.
describe("06-ao3-preface-and-chapters", () => {
  it("Opted-out pseud is rejected", async () => {
    const t = token();
    await addOptOut(`moon child ${t}`);
    const workId = freshAo3WorkId();

    expectOptedOut(await ingestEpub(workId, `Moon Child ${t}`));
    expect(await workExists(workId)).toBe(false);
  });

  it("Work under takedown is rejected", async () => {
    const removed = await seededWork({ status: "removed" });
    await addTakedown(removed.workId, TAKEDOWN_REMOVED);

    expectOptedOut(await ingestEpub(removed.ao3WorkId));
  });
});
