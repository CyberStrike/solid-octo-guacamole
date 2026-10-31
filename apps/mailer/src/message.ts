// The email queue's message contract. The web Worker produces it; the mailer consumes it.
// `from` is not part of it: the mailer sets it.
export interface SignInEmail {
  kind: "sign-in";
  to: string;
  url: string;
}

/** The wait list's double opt-in email (ARCHITECTURE, Wait list). */
export interface WaitlistConfirmEmail {
  kind: "waitlist-confirm";
  to: string;
  url: string;
}

export type EmailMessage = SignInEmail | WaitlistConfirmEmail;

const SITE = "https://rarepair.fans";
const MAX_URL = 2048;

// Each kind links to one page on the site, and to nothing else: a sign-in link to GET
// /login/confirm (ARCHITECTURE, Auth and Hosts), a wait list link to GET /waitlist/confirm.
const LINK_PATHS: Record<EmailMessage["kind"], string> = {
  "sign-in": "/login/confirm",
  "waitlist-confirm": "/waitlist/confirm",
};

/**
 * Whether the mailer sends to an address: a bare address only, with no display name and no
 * list, at most 254 characters. apps/web accepts a wait list address only if this would.
 */
export const isSendableAddress = (to: string) =>
  to.length <= 254 && /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+$/.test(to);

// Returns the message if its body keeps the contract, or null. A body that doesn't can never
// be sent, so retrying it would only keep an address in the queue longer.
export function parseMessage(body: unknown): EmailMessage | null {
  if (typeof body !== "object" || body === null) return null;
  // SAFETY: body is a non-null object, so reading named properties off it is safe; each value
  // is checked below.
  const { kind, to, url } = body as Record<string, unknown>;
  if (kind !== "sign-in" && kind !== "waitlist-confirm") return null;
  if (typeof to !== "string" || !isSendableAddress(to)) return null;
  if (typeof url !== "string" || url.length > MAX_URL) return null;
  // The kind's own page on the site, with no user info to disguise the host and no fragment.
  const link = URL.parse(url);
  if (link === null || link.origin !== SITE || link.pathname !== LINK_PATHS[kind]) return null;
  if (link.username !== "" || link.password !== "" || link.hash !== "") return null;
  // A wait list link without its token could confirm nothing.
  if (kind === "waitlist-confirm" && !link.searchParams.get("token")) return null;
  // The parsed href, not the raw string: parsing drops line breaks that would add lines to the email.
  return { kind, to, url: link.href };
}
