import { describe, expect, it } from "vitest";
import { ao3Epub } from "../../../packages/epub/test/helpers";
import {
  bucketText,
  deliver,
  liveWork,
  freshAo3WorkId,
  pendingUpload,
  savedRows,
  uploadRow,
} from "./helpers";

describe("08-versioning-and-dedupe", () => {
  it("First upload creates the work", async () => {
    // The scenario's 67890 stands for an ID no work has: here, one no other test uses, since a
    // rerun on the same database (vitest watch) would find a fixed ID's work from the first run.
    const workId = freshAo3WorkId();
    const id = await pendingUpload(
      ao3Epub({ workId, stats: "Published: 2020-01-02 Words: 3 Chapters: 1/1" }),
    );
    expect((await savedRows(workId, id)).works).toEqual([]);

    const result = await deliver([{ upload_id: id }]);
    // The same message again, as the queue may deliver it: the upload is live, so it is done.
    const again = await deliver([{ upload_id: id }]);

    const { works, versions } = await savedRows(workId, id);
    expect(works).toHaveLength(1);
    expect(versions).toHaveLength(1);
    expect(works[0]?.current_version_id).toBe(versions[0]?.id);
    const row = await uploadRow(id);
    expect(row.status).toBe("live");
    expect(row.work_id).toBe(works[0]?.id);
    expect(result.explicitAcks).toEqual(["msg-0"]);
    expect(again.explicitAcks).toEqual(["msg-0"]);

    // What the reader gets.
    const live = await liveWork(workId);
    expect(live?.work).toMatchObject({
      ao3_work_id: workId,
      title: "Synthetic Work",
      language: "English",
      words: 3,
      chapters_count: 1,
      chapters_total: 1,
      complete: true,
      status: "live",
    });
    expect(live?.work.published_at).toEqual(new Date("2020-01-02T00:00:00Z"));
    expect(live?.authors).toEqual([{ pseud: "someone", ao3_user: "someone" }]);
    expect(live?.chapters).toEqual([
      // Two words in the chapter, as the processor counts them; the work's total is the Stats line's.
      { n: 1, title: "Synthetic Work", words: 2, r2_key: `works/${workId}/${id}/1.html` },
    ]);
    expect(await bucketText(`works/${workId}/${id}/1.html`)).toContain("marker-only-chapter text.");
  });
});
