import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/index";

const E = env as unknown as Env;
const worker = (exports as any).default as Fetcher;
const ORIGIN = "https://content.rarepair.fans";

// Synthetic bytes only: a PNG signature, and an arbitrary blob standing in for an epub.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const EPUB = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 8, 7, 6]);

const IMAGE_KEY = "works/123456/img/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const ORIGINAL_KEY = "originals/01J9ZQ4K7M3XYV8T2W5R6N0B1C";

const get = (key: string, init: RequestInit = {}) => worker.fetch(`${ORIGIN}/${key}`, init);

async function seed() {
  await E.BUCKET.put(IMAGE_KEY, PNG, { httpMetadata: { contentType: "image/png" } });
  await E.BUCKET.put(ORIGINAL_KEY, EPUB, { httpMetadata: { contentType: "application/epub+zip" } });
}

describe("09-content-origin", () => {
  it("Content origin sets no cookies", async () => {
    await seed();
    for (const key of [IMAGE_KEY, ORIGINAL_KEY]) {
      const res = await get(key, { headers: { cookie: "session=abc" } });
      expect(res.status).toBe(200);
      expect(res.headers.has("set-cookie")).toBe(false);
      await res.arrayBuffer();
    }
  });

  it("Responses forbid content sniffing", async () => {
    await seed();
    const responses = [
      await get(IMAGE_KEY),
      await get(ORIGINAL_KEY),
      await get("works/123456/img/missing"),
      await get("about"),
    ];
    for (const res of responses) {
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      await res.arrayBuffer();
    }
  });

  it("Images and downloads are cached as immutable", async () => {
    await seed();
    for (const key of [IMAGE_KEY, ORIGINAL_KEY]) {
      const res = await get(key);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      await res.arrayBuffer();
    }
    // A miss is not cached as immutable: the key may be written later.
    const miss = await get("works/123456/img/missing");
    expect(miss.status).toBe(404);
    expect(miss.headers.get("cache-control")).toBe("no-store");
  });

  it("Original epub downloads as an attachment", async () => {
    await seed();
    const res = await get(ORIGINAL_KEY);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(EPUB);
  });
});
