import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import handler, { type Env } from "../src/index";

const E = env as unknown as Env;
const worker = (exports as any).default as Fetcher;
const ORIGIN = "https://content.rarepair.fans";

// Synthetic bytes only: a PNG signature, and an arbitrary blob standing in for an epub.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const EPUB = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 8, 7, 6]);

const IMAGE_KEY =
  "works/123456/img/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const MISSING_IMAGE_KEY = "works/123456/img/" + "0".repeat(64);
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
      await get(MISSING_IMAGE_KEY),
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
    const miss = await get(MISSING_IMAGE_KEY);
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

  it("Original epub is never displayed inline", async () => {
    // Stored metadata is not trusted: an object written with an HTML type and an
    // inline disposition still downloads as an epub attachment.
    await E.BUCKET.put(ORIGINAL_KEY, EPUB, {
      httpMetadata: { contentType: "text/html", contentDisposition: "inline" },
    });
    for (const method of ["GET", "HEAD"]) {
      const res = await get(ORIGINAL_KEY, { method });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toBe("attachment");
      expect(res.headers.get("content-type")).toBe("application/epub+zip");
      await res.arrayBuffer();
    }
  });

  it("Content origin only serves images and original downloads", async () => {
    await seed();
    // Things that exist in the bucket but are not images or originals.
    const html = new TextEncoder().encode("<p>x</p>");
    const fragment = "works/123456/01J9ZQ4K7M3XYV8T2W5R6N0B1C/1.html";
    await E.BUCKET.put(fragment, html, { httpMetadata: { contentType: "text/html" } });
    await E.BUCKET.put("uploads/01J9ZQ4K7M3XYV8T2W5R6N0B1C", EPUB);
    await E.BUCKET.put("index.html", html, { httpMetadata: { contentType: "text/html" } });
    await E.BUCKET.put("works/123456/img/.hidden", PNG, {
      httpMetadata: { contentType: "image/png" },
    });
    await E.BUCKET.put("originals/.hidden", EPUB);
    // Image keys that are not a SHA-256 hex digest, so not versioned by their key.
    const unversioned = ["works/123456/img/cover.png", `works/123456/img/${"A".repeat(64)}`];
    for (const key of unversioned) {
      await E.BUCKET.put(key, PNG, { httpMetadata: { contentType: "image/png" } });
    }
    const refused = [
      ...unversioned,
      // Stored keys asked for with a query string: a second URL a purge would miss.
      `${IMAGE_KEY}?v=2`,
      `${ORIGINAL_KEY}?x=1`,
      `${ORIGINAL_KEY}?`,
      fragment,
      "uploads/01J9ZQ4K7M3XYV8T2W5R6N0B1C",
      "index.html",
      "",
      "works/123456/work",
      "works/abc/img/x",
      "works/123456/img/a/b",
      "works/123456/img/",
      "works/123456/img/..%2f01J9ZQ4K7M3XYV8T2W5R6N0B1C%2f1.html",
      "works/123456/img/%2e%2e",
      // Reaches the Worker as is (no dot segment to resolve), so the regex refuses it.
      "works/123456/img/.hidden",
      "originals/.hidden",
      "originals/",
      "originals/a/b",
      `/${ORIGINAL_KEY}`,
    ];
    for (const key of refused) {
      const res = await get(key);
      expect(res.status, key).toBe(404);
      expect(res.headers.get("content-type") ?? "", key).not.toMatch(/html/);
      expect(await res.text(), key).toBe("");
    }

    // An image whose stored type is HTML is not served as HTML.
    await E.BUCKET.put(IMAGE_KEY, html, { httpMetadata: { contentType: "text/html" } });
    const image = await get(IMAGE_KEY);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("application/octet-stream");
    await image.arrayBuffer();

    // A stored image type is kept for real images.
    await E.BUCKET.put(IMAGE_KEY, PNG, { httpMetadata: { contentType: "image/png" } });
    const png = await get(IMAGE_KEY);
    expect(png.headers.get("content-type")).toBe("image/png");
    await png.arrayBuffer();
  });
});

describe("19-surge-controls-and-quotas", () => {
  it("Content origin is edge-cached", async () => {
    await seed();
    for (const key of [IMAGE_KEY, ORIGINAL_KEY]) {
      const res = await get(key);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      await res.arrayBuffer();
    }
  });
});

// Behaviour no scenario case names, but the content protocol and the notes' defaults do.
describe("content Worker", () => {
  it("HEAD answers with the headers and no body", async () => {
    await seed();
    const res = await get(IMAGE_KEY, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("");
  });

  it("A 404 carries the common headers and no body, on GET and HEAD", async () => {
    await seed();
    await E.BUCKET.put("index.html", new TextEncoder().encode("<p>x</p>"));
    // A refused path and a well-formed key that is not in the bucket.
    for (const key of ["index.html", MISSING_IMAGE_KEY]) {
      for (const method of ["GET", "HEAD"]) {
        const res = await get(key, { method, headers: { cookie: "session=abc" } });
        expect(res.status, `${method} ${key}`).toBe(404);
        expect(res.headers.get("cache-control"), `${method} ${key}`).toBe("no-store");
        expect(res.headers.get("x-content-type-options"), `${method} ${key}`).toBe("nosniff");
        expect(res.headers.has("set-cookie"), `${method} ${key}`).toBe(false);
        expect(await res.text(), `${method} ${key}`).toBe("");
      }
    }
  });

  it("Methods other than GET and HEAD are refused", async () => {
    await seed();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await get(IMAGE_KEY, { method, body: method === "DELETE" ? undefined : "x" });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow"), method).toBe("GET, HEAD");
      expect(res.headers.get("cache-control"), method).toBe("no-store");
      expect(res.headers.get("x-content-type-options"), method).toBe("nosniff");
      expect(res.headers.has("set-cookie"), method).toBe(false);
      await res.arrayBuffer();
    }
    // The bucket is untouched.
    expect(await E.BUCKET.head(IMAGE_KEY)).not.toBeNull();
  });

  it("A failed R2 read is an empty 503 with the common headers", async () => {
    // Miniflare's bucket can't be made to fail, so this one case hands the Worker's
    // fetch entry a bucket whose read rejects.
    const failing = {
      BUCKET: { get: () => Promise.reject(new Error("R2 unavailable")) } as unknown as R2Bucket,
    };
    for (const method of ["GET", "HEAD"]) {
      const res = await handler.fetch(new Request(`${ORIGIN}/${IMAGE_KEY}`, { method }), failing);
      expect(res.status, method).toBe(503);
      expect(res.headers.get("cache-control"), method).toBe("no-store");
      expect(res.headers.get("x-content-type-options"), method).toBe("nosniff");
      expect(res.headers.has("set-cookie"), method).toBe(false);
      expect(res.headers.get("content-type") ?? "", method).not.toMatch(/html/);
      expect(await res.text(), method).toBe("");
    }
  });

  it("A key deleted from R2 is no longer served", async () => {
    await seed();
    const before = await get(IMAGE_KEY);
    expect(before.status).toBe(200);
    await before.arrayBuffer();
    await E.BUCKET.delete([IMAGE_KEY, ORIGINAL_KEY]);
    for (const key of [IMAGE_KEY, ORIGINAL_KEY]) {
      const res = await get(key);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toBe("");
    }
  });
});
