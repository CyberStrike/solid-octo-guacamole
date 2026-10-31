import { describe, expect, it } from "vitest";
import { normalizeTagName } from "../src/index";

describe("06 AO3 preface and chapters", () => {
  it("Tags are stored as written with a normalized form", () => {
    expect(normalizeTagName("fandom", "Harry Potter - J. K. Rowling")).toBe(
      "harry potter j k rowling",
    );
  });
});

describe("14 browse and home", () => {
  it("Tag matching uses the normalized form", () => {
    expect(normalizeTagName("fandom", "Harry Potter")).toBe("harry potter");
    expect(normalizeTagName("fandom", "harry  potter!")).toBe("harry potter");
  });
});

describe("normalizeTagName", () => {
  it("Punctuation folds to a space, as whitespace does", () => {
    expect(normalizeTagName("freeform", "a_b")).toBe("a b");
    expect(normalizeTagName("freeform", "a b")).toBe("a b");
  });

  it("A fandom with a distinguishing suffix stays distinct", () => {
    expect(normalizeTagName("fandom", "Harry Potter - J. K. Rowling")).not.toBe(
      normalizeTagName("fandom", "Harry Potter"),
    );
  });

  it("Relationship tags keep / and & apart", () => {
    expect(normalizeTagName("relationship", "Kirk/Spock")).toBe("kirk/spock");
    expect(normalizeTagName("relationship", "Kirk & Spock")).toBe("kirk & spock");
  });

  it("Other tag types fold / and & like any punctuation", () => {
    expect(normalizeTagName("freeform", "Hurt/Comfort")).toBe("hurt comfort");
    expect(normalizeTagName("freeform", "Hurt & Comfort")).toBe("hurt comfort");
  });

  it("Letters in any script survive, and symbols are kept", () => {
    expect(normalizeTagName("fandom", "  名探偵コナン  ")).toBe("名探偵コナン");
    expect(normalizeTagName("freeform", "C++")).toBe("c++");
  });

  it("Compatibility forms fold to their plain letters", () => {
    expect(normalizeTagName("freeform", "ＡＢＣ")).toBe("abc");
  });
});
