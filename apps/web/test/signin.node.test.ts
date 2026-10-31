import { describe, expect, it } from "vitest";
import { isSameOrigin, safeNext } from "../src/signin";

describe("safeNext", () => {
  it("keeps a same-site path and its query", () => {
    expect(safeNext("/works/1")).toBe("/works/1");
    expect(safeNext("/works/1/chapters/2?x=1")).toBe("/works/1/chapters/2?x=1");
  });

  it("reduces anything that could leave the site to the home page", () => {
    for (const next of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      // Passes the first checks, but normalizes to //evil.example.
      "/a/..//evil.example",
      "/works/1\n",
      "/works/\u00001",
      "works/1",
      "",
    ]) {
      expect(safeNext(next)).toBe("/");
    }
  });

  it("gives the home page when there is no next", () => {
    expect(safeNext(null)).toBe("/");
  });
});

const headers = (init: Record<string, string>) => new Headers(init);

describe("isSameOrigin", () => {
  it("accepts a form posted from the site itself", () => {
    expect(isSameOrigin(headers({ origin: "https://rarepair.fans" }))).toBe(true);
    expect(isSameOrigin(headers({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(
      isSameOrigin(headers({ origin: "https://rarepair.fans", "sec-fetch-site": "same-origin" })),
    ).toBe(true);
  });

  it("refuses another site, or another rarepair.fans host", () => {
    const refused: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { origin: "https://content.rarepair.fans" },
      { origin: "http://rarepair.fans" },
      { origin: "null" },
      { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "none" },
      // Each header present must pass on its own.
      { origin: "https://rarepair.fans", "sec-fetch-site": "same-site" },
      { origin: "https://content.rarepair.fans", "sec-fetch-site": "same-origin" },
    ];
    for (const init of refused) expect(isSameOrigin(headers(init))).toBe(false);
  });

  it("refuses a request that carries neither header", () => {
    expect(isSameOrigin(headers({}))).toBe(false);
  });
});
