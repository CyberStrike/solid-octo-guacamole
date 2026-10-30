export interface Env {
  BUCKET: R2Bucket;
}

const IMMUTABLE = "public, max-age=31536000, immutable";

// The only keys this origin serves. A segment is one plain path segment: no slash,
// no percent-encoding, no leading dot. The path is used as the R2 key undecoded.
const SEGMENT = "[A-Za-z0-9_-][A-Za-z0-9._-]*";
const IMAGE = new RegExp(`^/works/\\d+/img/${SEGMENT}$`);
const ORIGINAL = new RegExp(`^/originals/${SEGMENT}$`);

// Ingest stores only these image types (ARCHITECTURE, EPUB processor step 6).
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Every response, errors included, goes out through here: no cookie, no sniffing. */
function respond(body: BodyInit | null, status: number, headers: Record<string, string> = {}) {
  const h = new Headers(headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.delete("Set-Cookie");
  return new Response(body, { status, headers: h });
}

const notFound = () => respond(null, 404, { "Cache-Control": "no-store" });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    const isImage = IMAGE.test(path);
    const isOriginal = ORIGINAL.test(path);
    if (!isImage && !isOriginal) return notFound();

    const object = await env.BUCKET.get(path.slice(1));
    if (!object) return notFound();

    // Stored HTTP metadata is never echoed: type and disposition are set here.
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
