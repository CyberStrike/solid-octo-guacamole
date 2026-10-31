import { describe, expect, it } from "vitest";
import { ao3Epub, zipEntries } from "../../../packages/epub/test/helpers";
import {
  bucketKeys,
  deliver,
  liveWork,
  newWorkId,
  parsedWork,
  pendingUpload,
  savedRows,
  uploadRow,
  watchedWorker,
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

  it("Provenance from the preface line", async () => {
    const workId = newWorkId();
    const id = await pendingUpload(ao3Epub({ workId }));

    await deliver([{ upload_id: id }]);

    const live = await liveWork(workId);
    expect(live?.work.ao3_work_id).toBe(workId);
    expect(live?.version.r2_prefix).toBe(`works/${workId}/${id}/`);
    expect(await bucketKeys(`works/${workId}/`)).toEqual([`works/${workId}/${id}/1.html`]);
  });

  it("Unknown labels are kept in raw_meta", async () => {
    const workId = newWorkId();
    const id = await pendingUpload(
      ao3Epub({
        workId,
        extraDl: `<dt class="calibre3">Synthetic Label:</dt><dd class="calibre4">synthetic value</dd>`,
      }),
    );

    await deliver([{ upload_id: id }]);

    expect((await uploadRow(id)).status).toBe("live");
    const { works } = await savedRows(workId, id);
    expect(works.map((w) => w.raw_meta)).toEqual([{ "Synthetic Label": "synthetic value" }]);
  });

  it("Tags are stored as written with a normalized form", async () => {
    const work = parsedWork({
      fandoms: ["Harry Potter - J. K. Rowling"],
      relationships: ["Kirk / Spock"],
    });
    const workId = Number(work.ao3WorkId);
    const id = await pendingUpload(ao3Epub({ workId }));
    const { handler } = watchedWorker({ process: async () => work });

    await deliver([{ upload_id: id }], { handler });

    const live = await liveWork(workId);
    // In the author's order: rating, warnings, then the fandom and the relationship.
    expect(live?.tags.map(({ type, name, name_norm }) => ({ type, name, name_norm }))).toEqual([
      { type: "rating", name: "General Audiences", name_norm: "general audiences" },
      {
        type: "warning",
        name: "No Archive Warnings Apply",
        name_norm: "no archive warnings apply",
      },
      {
        type: "fandom",
        name: "Harry Potter - J. K. Rowling",
        name_norm: "harry potter j k rowling",
      },
      { type: "relationship", name: "Kirk / Spock", name_norm: "kirk/spock" },
    ]);
  });

  it("Anonymous works stay anonymous", async () => {
    const work = parsedWork({ authors: [{ pseud: "Anonymous", user: null }] });
    const workId = Number(work.ao3WorkId);
    const id = await pendingUpload(ao3Epub({ workId }));
    const { handler } = watchedWorker({ process: async () => work });

    await deliver([{ upload_id: id }], { handler });

    expect((await liveWork(workId))?.authors).toEqual([{ pseud: "Anonymous", ao3_user: null }]);
  });
});
