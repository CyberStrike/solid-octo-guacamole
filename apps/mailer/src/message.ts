// The email queue's message contract. The web Worker produces it; the mailer consumes it.
// `from` is not part of it: the mailer sets it.
export interface SignInEmail {
  kind: "sign-in";
  to: string;
  url: string;
}

export type EmailMessage = SignInEmail;

// Returns the message if its body keeps the contract, or null. A body that doesn't can never
// be sent, so retrying it would only keep an address in the queue longer.
export function parseMessage(body: unknown): EmailMessage | null {
  if (typeof body !== "object" || body === null) return null;
  const { kind, to, url } = body as Record<string, unknown>;
  if (kind !== "sign-in") return null;
  if (typeof to !== "string" || !/^[^\s@]+@[^\s@]+$/.test(to)) return null;
  if (typeof url !== "string" || !URL.canParse(url) || new URL(url).protocol !== "https:") return null;
  return { kind, to, url };
}
