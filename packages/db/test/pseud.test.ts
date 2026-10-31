import { describe, expect, it } from "vitest";
import { normalizePseud, normalizeTagName } from "../src/index";

describe("16 removal and opt-out", () => {
  it("Opt-out matches a pseud that differs only in case", () => {
    expect(normalizePseud("moon CHILD")).toBe("moon child");
    expect(normalizePseud("Moon Child")).toBe("moon child");
  });

  it("Opt-out matches a pseud with extra spaces", () => {
    expect(normalizePseud("  Moon   Child ")).toBe("moon child");
  });

  it("Opt-out does not match different punctuation", () => {
    expect(normalizePseud("Moon_Child")).toBe("moon_child");
    expect(normalizePseud("a_b")).not.toBe(normalizePseud("a b"));
  });
});

describe("normalizePseud", () => {
  it("Compatibility forms match their plain letters", () => {
    // Fullwidth "Ｍ" (U+FF2D) and a no-break space (U+00A0).
    expect(normalizePseud("Ｍoon Child")).toBe("moon child");
  });

  it("Whitespace of any kind collapses to one space", () => {
    // A tab, and an ideographic space (U+3000).
    expect(normalizePseud("Moon\tChild")).toBe("moon child");
    expect(normalizePseud("Moon　Child")).toBe("moon child");
  });

  it("Punctuation is kept, unlike in a tag's name_norm", () => {
    expect(normalizePseud("Moon-Child!!")).toBe("moon-child!!");
    expect(normalizeTagName("freeform", "Moon-Child!!")).toBe("moon child");
  });

  it("Lowercasing is not full case folding", () => {
    expect(normalizePseud("STRASSE")).toBe("strasse");
    expect(normalizePseud("Straße")).toBe("straße");
  });

  it("A blank pseud normalizes to the empty string", () => {
    expect(normalizePseud("")).toBe("");
    expect(normalizePseud(" \t ")).toBe("");
  });

  it("Normalizing twice changes nothing", () => {
    const once = normalizePseud("  Ｍoon CHILD_ ");
    expect(once).toBe("moon child_");
    expect(normalizePseud(once)).toBe(once);
  });
});
