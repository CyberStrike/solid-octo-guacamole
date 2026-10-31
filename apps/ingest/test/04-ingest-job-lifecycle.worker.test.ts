import { describe, expect, it } from "vitest";
import { ao3Epub } from "../../../packages/epub/test/helpers";
import { deliver, pendingUpload, uploadRow } from "./helpers";

describe("04-ingest-job-lifecycle", () => {
  it("Lease claims a pending upload", async () => {
    const id = await pendingUpload(ao3Epub());

    const result = await deliver([{ upload_id: id }]);

    const row = await uploadRow(id);
    expect(row.status).toBe("processing");
    expect(row.lease_until!.getTime()).toBeGreaterThan(Date.now());
    expect(result.explicitAcks).toEqual(["msg-0"]);
  });
});
