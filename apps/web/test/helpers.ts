import { env, exports } from "cloudflare:workers";
import { parseMessage, type EmailMessage } from "../../mailer/src/message";

// Shared by the workerd tests. (11-reader-and-csp and 20-site-chrome keep their own
// copies for now.)

export const BASE = "https://rarepair.fans";
// SAFETY: the default export is the Worker under test, loaded from wrangler.jsonc's main.
const worker = (exports as any).default as Fetcher;

/** A request to the Worker under test, with redirects returned rather than followed. */
export const fetchW = (input: string, init: RequestInit = {}) =>
  worker.fetch(new URL(input, BASE).toString(), { redirect: "manual", ...init });

// The policies from ARCHITECTURE, Reading, with the nonce left as {n}.
export const STRICT =
  "default-src 'self'; script-src 'nonce-{n}' 'strict-dynamic'; style-src 'self'; img-src 'self' https://content.rarepair.fans; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export const TURNSTILE = `${STRICT}; frame-src https://challenges.cloudflare.com`;

/** The nonce in a CSP header, or null when there is none. */
export const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']*)'/)?.[1] ?? null;

/** The header with its nonce swapped back to {n}, for whole-string comparison. */
export const withoutNonce = (csp: string | null) =>
  csp?.replace(/'nonce-[^']*'/, "'nonce-{n}'") ?? null;

/** Every message the `email` queue has delivered so far, from vitest.config.ts's email-sink. */
export async function deliveredEmails(): Promise<unknown[]> {
  // SAFETY: the sink answers with the JSON array of message bodies it was delivered.
  return (await (await env.EMAIL_SINK.fetch("https://email-sink/")).json()) as unknown[];
}

/**
 * Waits for the queue to deliver `atLeast` messages to `to`, and returns every one it has.
 * Fails, naming the address, if they haven't come in 10 seconds.
 */
export async function emailsTo(to: string, { atLeast = 1 } = {}): Promise<EmailMessage[]> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const mine = (await deliveredEmails())
      .map(parseMessage)
      .filter((email): email is EmailMessage => email?.to === to);
    if (mine.length >= atLeast) return mine;
    if (Date.now() > deadline) {
      throw new Error(`${mine.length} of ${atLeast} emails to ${to} delivered in 10 seconds`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// The token vitest.config.ts's siteverify stand-in passes, as Cloudflare's test secret does.
export const PASSING_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/** The headers a browser on rarepair.fans sends with the sign-in form. */
const LOGIN_HEADERS = {
  "content-type": "application/x-www-form-urlencoded",
  origin: BASE,
  "sec-fetch-site": "same-origin",
};

/** The sign-in form's POST, as a browser on rarepair.fans submits it. */
export const loginRequest = (fields: Record<string, string>) =>
  new Request(`${BASE}/login`, {
    method: "POST",
    headers: LOGIN_HEADERS,
    body: new URLSearchParams(fields).toString(),
  });

/** Submits the sign-in form to the Worker; `headers` are added over a browser's. */
export function postLogin(
  fields: Record<string, string>,
  {
    url = "/login",
    headers = {},
    body = new URLSearchParams(fields).toString(),
  }: { url?: string; headers?: Record<string, string>; body?: BodyInit } = {},
) {
  return fetchW(url, { method: "POST", headers: { ...LOGIN_HEADERS, ...headers }, body });
}
