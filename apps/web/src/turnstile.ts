// The server half of a Turnstile check, shared by every form that has one:
// sign-in, upload requests and removal requests (ARCHITECTURE, Surge controls).
// It takes everything site-specific as arguments, so each route passes its own.

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
// Cloudflare's limit on a token's length.
const MAX_TOKEN = 2048;

/**
 * `passed` only when Cloudflare says so for this host. `unavailable` when
 * Cloudflare couldn't be asked: the caller refuses the request either way.
 */
export type TurnstileResult = "passed" | "failed" | "unavailable";

export interface TurnstileCheck {
  /** The widget's secret key. */
  secret: string;
  /** The host the form was served on. A token solved on any other host fails. */
  hostname: string;
  /** The visitor's address (`cf-connecting-ip`), when known. */
  remoteIp?: string | null;
  /** The Worker's `fetch`; a test passes its own. */
  fetch?: typeof fetch;
}

/** Checks the `cf-turnstile-response` value of a submitted form. */
export async function verifyTurnstile(
  token: FormDataEntryValue | null | undefined | string[],
  check: TurnstileCheck,
): Promise<TurnstileResult> {
  if (typeof token !== "string" || token === "" || token.length > MAX_TOKEN) return "failed";
  const body = new URLSearchParams({ secret: check.secret, response: token });
  if (check.remoteIp) body.set("remoteip", check.remoteIp);

  let reply: { success?: unknown; hostname?: unknown };
  try {
    const res = await (check.fetch ?? fetch)(SITEVERIFY, { method: "POST", body });
    if (!res.ok) return "unavailable";
    reply = await res.json();
  } catch {
    // Unreachable, or an answer that isn't JSON.
    return "unavailable";
  }
  return reply.success === true && reply.hostname === check.hostname ? "passed" : "failed";
}
