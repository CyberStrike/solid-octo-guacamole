import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/message";

describe("ingest message contract", () => {
  it("takes an upload id of 1 to 64 characters", () => {
    expect(parseMessage({ upload_id: "a" })).toEqual({ upload_id: "a" });
    expect(parseMessage({ upload_id: "x".repeat(64) })).toEqual({ upload_id: "x".repeat(64) });
  });

  it("refuses a body that names no upload", () => {
    expect(parseMessage({ upload_id: "" })).toBeNull();
    expect(parseMessage({ upload_id: "x".repeat(65) })).toBeNull();
    expect(parseMessage({ upload_id: 7 })).toBeNull();
    expect(parseMessage({ uploadId: "a" })).toBeNull();
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage("a")).toBeNull();
  });
});
