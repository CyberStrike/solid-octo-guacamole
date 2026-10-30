import type { MiddlewareHandler } from "hono";

export type SecurityVariables = { nonce: string };

// ARCHITECTURE, Reading: the strict policy every app page sends.
const strictPolicy = (nonce: string) =>
  [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self'",
    "img-src 'self' https://content.rarepair.fans",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

/** A fresh base64 nonce of 16 random bytes. */
const newNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

/** Sets the CSP on every HTML response, with a nonce handlers read as c.get("nonce"). */
export const contentSecurityPolicy: MiddlewareHandler<{ Variables: SecurityVariables }> = async (
  c,
  next,
) => {
  const nonce = newNonce();
  c.set("nonce", nonce);
  await next();
  if (c.res.headers.get("content-type")?.startsWith("text/html")) {
    c.res.headers.set("Content-Security-Policy", strictPolicy(nonce));
  }
};
