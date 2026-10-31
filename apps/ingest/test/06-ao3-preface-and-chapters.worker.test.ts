import { describe, expect, it } from "vitest";
import { ao3Epub, zipEntries } from "../../../packages/epub/test/helpers";
import { TAKEDOWN_REMOVED } from "../src/lists";
import {
  addOptOut,
  addTakedown,
  bucketKeys,
  deliver,
  expectOptedOut,
  freshAo3WorkId,
  ingestEpub,
  liveWork,
  parsedWork,
  pendingUpload,
  savedRows,
  seededWork,
  token,
  uploadRow,
  watchedWorker,
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

  it("Provenance from the preface line", async () => {
    const workId = freshAo3WorkId();
    const id = await pendingUpload(ao3Epub({ workId }));

    await deliver([{ upload_id: id }]);

    const live = await liveWork(workId);
    expect(live?.work.ao3_work_id).toBe(workId);
    expect(live?.version.r2_prefix).toBe(`works/${workId}/${id}/`);
    expect(await bucketKeys(`works/${workId}/`)).toEqual([`works/${workId}/${id}/1.html`]);
  });

  it("Unknown labels are kept in raw_meta", async () => {
    const workId = freshAo3WorkId();
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

  it("stores the Stats line's counts and dates, with unknown or impossible ones as NULL", async () => {
    const cases = [
      {
        stats: {
          published: "2020-01-02",
          updated: "2020-03-04",
          completed: null,
          words: 7,
          chapters: { posted: 2, total: null },
        },
        expected: {
          words: 7,
          chapters_total: null,
          complete: false,
          published_at: new Date("2020-01-02T00:00:00Z"),
          updated_at: new Date("2020-03-04T00:00:00Z"),
        },
      },
      {
        // Words from the chapters when Stats has none; Completed when there is no Updated.
        stats: {
          published: "2020-02-31",
          updated: null,
          completed: "2021-05-06",
          words: null,
          chapters: { posted: 2, total: 2_147_483_648 },
        },
        expected: {
          words: 2,
          chapters_total: null,
          complete: true,
          published_at: null,
          updated_at: new Date("2021-05-06T00:00:00Z"),
        },
      },
      {
        stats: {
          published: "not a date",
          updated: null,
          completed: null,
          // Out of range: the chapters' sum stands in, as for no count at all.
          words: 3_000_000_000,
          chapters: { posted: 2, total: 2 },
        },
        expected: {
          words: 2,
          chapters_total: 2,
          complete: true,
          published_at: null,
          updated_at: null,
        },
      },
    ];
    for (const { stats, expected } of cases) {
      const work = parsedWork({
        stats,
        chapters: [
          { n: 1, title: "One", html: "<p>one</p>", words: 1 },
          { n: 2, title: "Two", html: "<p>two</p>", words: 1 },
        ],
      });
      const workId = Number(work.ao3WorkId);
      const id = await pendingUpload(ao3Epub({ workId }));
      const { handler } = watchedWorker({ process: async () => work });

      await deliver([{ upload_id: id }], { handler });

      const live = await liveWork(workId);
      expect(live?.work).toMatchObject({ ...expected, chapters_count: 2 });
      expect(live?.version.chapter_total).toBe(expected.chapters_total);
    }
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
