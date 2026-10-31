import { describe, expect, it } from "vitest";
import { normalizePseud, normalizeTagName } from "../src/index";

/** One character by code point, so no invisible character sits in the source. */
const ch = (codePoint: number) => String.fromCodePoint(codePoint);
const FULLWIDTH_M = ch(0xff2d);
const NO_BREAK_SPACE = ch(0xa0);
const IDEOGRAPHIC_SPACE = ch(0x3000);
const NEXT_LINE = ch(0x85);
const BYTE_ORDER_MARK = ch(0xfeff);
const ZERO_WIDTH_SPACE = ch(0x200b);
const ZERO_WIDTH_JOINER = ch(0x200d);
const WORD_JOINER = ch(0x2060);
const SOFT_HYPHEN = ch(0xad);
/** Combining grapheme joiner: invisible, and it keeps combining marks from reordering. */
const GRAPHEME_JOINER = ch(0x34f);
/** "J" and a combining caron, which has no precomposed capital. */
const J_CARON_UPPER = `J${ch(0x30c)}`;
/** Its lowercase, precomposed (U+01F0). */
const J_CARON = ch(0x1f0);

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
    expect(normalizePseud(`${FULLWIDTH_M}oon${NO_BREAK_SPACE}Child`)).toBe("moon child");
  });

  it("Whitespace of any kind collapses to one space", () => {
    expect(normalizePseud("Moon\tChild")).toBe("moon child");
    expect(normalizePseud(`Moon${IDEOGRAPHIC_SPACE}Child`)).toBe("moon child");
    // Unicode whitespace, though not in JavaScript's `\s`.
    expect(normalizePseud(`${NEXT_LINE}Moon${NEXT_LINE}Child${NEXT_LINE}`)).toBe("moon child");
  });

  it("Invisible characters are dropped, so zero-width variants match the plain pseud", () => {
    for (const invisible of [
      ZERO_WIDTH_SPACE,
      ZERO_WIDTH_JOINER,
      WORD_JOINER,
      SOFT_HYPHEN,
      BYTE_ORDER_MARK,
    ]) {
      const name = invisible.codePointAt(0)!.toString(16);
      expect(normalizePseud(`Moon${invisible} Child`), name).toBe("moon child");
      expect(normalizePseud(`${invisible}Moon Ch${invisible}ild${invisible}`), name).toBe(
        "moon child",
      );
      expect(normalizePseud(`Moon${invisible}Child`), name).toBe("moonchild");
    }
  });

  it("A pseud of only invisible characters is blank", () => {
    expect(normalizePseud(`${ZERO_WIDTH_SPACE}${WORD_JOINER} ${BYTE_ORDER_MARK}`)).toBe("");
  });

  it("Punctuation is kept, unlike in a tag's name_norm", () => {
    expect(normalizePseud("Moon-Child!!")).toBe("moon-child!!");
    expect(normalizeTagName("freeform", "Moon-Child!!")).toBe("moon child");
  });

  it("Lowercasing leaves the pseud in NFKC", () => {
    // "J" with a combining caron has no precomposed capital, so NFKC leaves it
    // decomposed, but its lowercase composes to U+01F0.
    expect(normalizePseud(J_CARON_UPPER)).toBe(J_CARON);
    expect(normalizePseud(J_CARON)).toBe(J_CARON);
  });

  it("Lowercasing is not full case folding", () => {
    expect(normalizePseud("STRASSE")).toBe("strasse");
    expect(normalizePseud(`Stra${ch(0xdf)}e`)).toBe(`stra${ch(0xdf)}e`);
  });

  it("A blank pseud normalizes to the empty string", () => {
    expect(normalizePseud("")).toBe("");
    expect(normalizePseud(" \t ")).toBe("");
  });

  it("Normalizing twice changes nothing", () => {
    const once = normalizePseud(`  ${FULLWIDTH_M}oon${NO_BREAK_SPACE}CHILD_ `);
    expect(once).toBe("moon child_");
    for (const input of [
      "Moon Child",
      "  Moon   Child ",
      "Moon_Child",
      "Moon-Child!!",
      `${FULLWIDTH_M}oon${NO_BREAK_SPACE}Child`,
      `${NEXT_LINE}Moon${BYTE_ORDER_MARK}Child`,
      J_CARON_UPPER,
      J_CARON,
      `Stra${ch(0xdf)}e`,
      " \t ",
      // Dotted capital I and a combining grave below: lowercasing puts the marks out of order.
      `${ch(0x130)}${ch(0x316)}`,
      `Moon${ZERO_WIDTH_SPACE} Child${WORD_JOINER}`,
      // An acute above, then a grave below: dropping the joiner between them leaves them out of order.
      `a${ch(0x301)}${GRAPHEME_JOINER}${ch(0x316)}`,
    ]) {
      const normalized = normalizePseud(input);
      expect(normalizePseud(normalized), JSON.stringify(input)).toBe(normalized);
      expect(normalized.normalize("NFKC"), JSON.stringify(input)).toBe(normalized);
    }
  });
});
