import { describe, expect, it } from "vitest";
import { fetchW } from "./helpers";

describe("14-browse-and-home before launch", () => {
  it("A tag listing is closed before launch", async () => {
    const res = await fetchW("/tags/fandom/harry%20potter");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });
});
