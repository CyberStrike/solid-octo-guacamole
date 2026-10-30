export interface Env {
  BUCKET: R2Bucket;
}

const IMMUTABLE = "public, max-age=31536000, immutable";

/** Every response, errors included, goes out through here: no cookie, no sniffing. */
function respond(body: BodyInit | null, status: number, headers: Record<string, string> = {}) {
  const h = new Headers(headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.delete("Set-Cookie");
  return new Response(body, { status, headers: h });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const key = new URL(request.url).pathname.slice(1);
    const object = await env.BUCKET.get(key);
    if (!object) return respond(null, 404, { "Cache-Control": "no-store" });
    return respond(object.body, 200, { "Cache-Control": IMMUTABLE });
  },
} satisfies ExportedHandler<Env>;
