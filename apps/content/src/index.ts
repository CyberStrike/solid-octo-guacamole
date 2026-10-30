export interface Env {
  BUCKET: R2Bucket;
}

const IMMUTABLE = "public, max-age=31536000, immutable";

// The only keys this origin serves. Images are keyed by the SHA-256 of their bytes
// (ARCHITECTURE, EPUB processor step 6), so an image path is versioned by its key.
// An original's key is one plain path segment: no slash, no percent-encoding, no
// leading dot. The path is used as the R2 key undecoded, after the URL parser has
// already resolved any dot segments, encoded or not.
const SEGMENT = "[A-Za-z0-9_-][A-Za-z0-9._-]*";
const IMAGE = /^\/works\/\d+\/img\/[0-9a-f]{64}$/;
const ORIGINAL = new RegExp(`^/originals/${SEGMENT}$`);

// Ingest stores only these image types (ARCHITECTURE, EPUB processor step 6).
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Every response this Worker returns, errors included, goes out through here with
 * `nosniff` (error pages the platform itself generates never reach this code). Its headers
 * are only this module's literals, so none sets a cookie; cookies a zone feature adds
 * after the Worker are kept off this host by zone config (ARCHITECTURE, Hosts).
 */
function respond(body: BodyInit | null, status: number, headers: Record<string, string> = {}) {
  const h = new Headers(headers);
  h.set("X-Content-Type-Options", "nosniff");
  return new Response(body, { status, headers: h });
}

const notFound = () => respond(null, 404, { "Cache-Control": "no-store" });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return respond(null, 405, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
    }
    // A query string, even an empty one (`search` is "" for a bare "?"), would make a
    // second cacheable URL for the same bytes, one that a purge of the bare URL on
    // removal would miss, so only bare paths are served.
    if (request.url.includes("?")) return notFound();
    const path = new URL(request.url).pathname;
    const isImage = IMAGE.test(path);
    const isOriginal = ORIGINAL.test(path);
    if (!isImage && !isOriginal) return notFound();

    // A failed read still goes out through respond(), empty and uncached.
    let object: R2ObjectBody | null;
    try {
      object = await env.BUCKET.get(path.slice(1));
    } catch {
      return respond(null, 503, { "Cache-Control": "no-store" });
    }
    if (!object) return notFound();

    // Stored disposition is never echoed. An original's type is fixed; an image keeps
    // its stored type only when it is one of the four that ingest writes.
    const headers: Record<string, string> = { "Cache-Control": IMMUTABLE };
    if (isOriginal) {
      headers["Content-Type"] = "application/epub+zip";
      headers["Content-Disposition"] = "attachment";
    } else {
      const stored = object.httpMetadata?.contentType ?? "";
      headers["Content-Type"] = IMAGE_TYPES.has(stored) ? stored : "application/octet-stream";
    }
    return respond(object.body, 200, headers);
  },
} satisfies ExportedHandler<Env>;
