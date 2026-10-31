import { describe, expect, it } from "vitest";
import { ao3Epub, zipEntries } from "../../../packages/epub/test/helpers";
import { deliver, pendingUpload, uploadRow, watchedWorker } from "./helpers";

describe("05-epub-unzip-limits", () => {
  it("Rejected upload records its code", async () => {
    // An entry that climbs out of the archive: rejected while unzipping.
    const id = await pendingUpload(zipEntries({ "../escape.xhtml": "<p>x</p>" }));
    const saved: string[] = [];
    const { handler } = watchedWorker({ save: async (upload) => void saved.push(upload.id) });

    const result = await deliver([{ upload_id: id }], { handler });

    const row = await uploadRow(id);
    expect(row.status).toBe("not_epub");
    expect(row.lease_until).toBeNull();
    expect(row.work_id).toBeNull();
    expect(saved).toEqual([]);
    expect(result.explicitAcks).toEqual(["msg-0"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("records zip_bomb for an archive of more than 2,000 entries", async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < 2_000; i++) entries[`f${i}.txt`] = "x";
    // Plus the mimetype entry: 2,001 in all.
    const id = await pendingUpload(zipEntries(entries));

    const result = await deliver([{ upload_id: id }]);

    expect((await uploadRow(id)).status).toBe("zip_bomb");
    expect(result.explicitAcks).toEqual(["msg-0"]);
  });

  it("records the processor's parse_failed at once, without a retry", async () => {
    // Nested more than 256 deep: the processor fails to parse it, the same way every time.
    const deep = `${"<div>".repeat(300)}x${"</div>".repeat(300)}`;
    const id = await pendingUpload(
      ao3Epub({
        files: [
          {
            name: "Synthetic_split_001.xhtml",
            body: `<div id="chapters" class="userstuff1"><h2 class="toc-heading">One</h2>
<div class="userstuff2">${deep}</div></div>`,
          },
        ],
      }),
    );

    const result = await deliver([{ upload_id: id }]);

    const row = await uploadRow(id);
    expect(row.status).toBe("parse_failed");
    expect(row.error_stage).toBe("process");
    expect(row.lease_until).toBeNull();
    expect(result.explicitAcks).toEqual(["msg-0"]);
    expect(result.retryMessages).toEqual([]);
  });
});
