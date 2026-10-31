// The email queue's message contract. The web Worker produces it; the mailer consumes it.
// `from` is not part of it: the mailer sets it.
export interface SignInEmail {
  kind: "sign-in";
  to: string;
  url: string;
}

// oxlint-disable-next-line deslop/no-pass-through-type-alias -- the union of message kinds, one so far
export type EmailMessage = SignInEmail;

const SITE = "https://rarepair.fans";
const MAX_URL = 2048;

// Returns the message if its body keeps the contract, or null. A body that doesn't can never
// be sent, so retrying it would only keep an address in the queue longer.
export function parseMessage(body: unknown): EmailMessage | null {
  if (typeof body !== "object" || body === null) return null;
  // SAFETY: body is a non-null object, so its keys are strings; each value is checked below.
  const { kind, to, url } = body as Record<string, unknown>;
  if (kind !== "sign-in") return null;
  // A bare address only: no display name, no list, at most 254 characters.
  if (
    typeof to !== "string" ||
    to.length > 254 ||
    !/^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+$/.test(to)
  ) {
    return null;
  }
  if (typeof url !== "string" || url.length > MAX_URL) return null;
  // A sign-in link goes to GET /login/confirm on the site (ARCHITECTURE, Auth and Hosts), with
  // no user info to disguise the host and no fragment.
  const link = URL.parse(url);
  if (link === null || link.origin !== SITE || link.pathname !== "/login/confirm") return null;
  if (link.username !== "" || link.password !== "" || link.hash !== "") return null;
  // The parsed href, not the raw string: parsing drops line breaks that would add lines to the email.
  return { kind, to, url: link.href };
}
