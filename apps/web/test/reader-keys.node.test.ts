import { describe, expect, it } from "vitest";
import { isFragmentKey } from "../src/reader";

// The reader's R2 guard. Rows the seed helper writes are always well formed, so the
// keys a corrupt or hostile row could hold are tested here, on the guard alone.
const PREFIX = "works/20001/0f0e0d0c-0000-4000-8000-000000000001/";

describe("isFragmentKey", () => {
  it("accepts a file directly under this work's version prefix", () => {
    expect(isFragmentKey(`${PREFIX}2.html`, 20001, PREFIX)).toBe(true);
  });

  it("refuses uploads, originals and images", () => {
    for (const key of [
      "uploads/0f0e0d0c-0000-4000-8000-000000000001.epub",
      "originals/20001.epub",
      `works/20001/img/${"ab".repeat(32)}`,
    ]) {
      expect(isFragmentKey(key, 20001, PREFIX), key).toBe(false);
    }
    // Not even when a corrupt version's prefix covers the key.
    expect(isFragmentKey(`works/20001/img/${"ab".repeat(32)}`, 20001, "works/20001/img/")).toBe(
      false,
    );
    expect(isFragmentKey("uploads/u.epub", 20001, "uploads/")).toBe(false);
    expect(isFragmentKey("originals/o.epub", 20001, "originals/")).toBe(false);
  });

  it("refuses another work's prefix and keys outside the version's prefix", () => {
    const other = "works/20002/0f0e0d0c-0000-4000-8000-000000000002/";
    expect(isFragmentKey(`${other}1.html`, 20001, other)).toBe(false);
    expect(isFragmentKey(`${other}1.html`, 20001, PREFIX)).toBe(false);
    expect(isFragmentKey("works/200010/x/1.html", 20001, "works/200010/x/")).toBe(false);
  });

  it("refuses a malformed prefix, and keys nested below or equal to it", () => {
    for (const prefix of [
      "works/",
      "works/20001/",
      "works/20001/a/b/",
      "works/20001/../",
      "works/20001/x",
    ]) {
      expect(isFragmentKey(`${prefix}1.html`, 20001, prefix), prefix).toBe(false);
    }
    expect(isFragmentKey(`${PREFIX}sub/1.html`, 20001, PREFIX)).toBe(false);
    expect(isFragmentKey(PREFIX, 20001, PREFIX)).toBe(false);
  });
});
