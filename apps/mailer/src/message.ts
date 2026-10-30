// The email queue's message contract. The web Worker produces it; the mailer consumes it.
// `from` is not part of it: the mailer sets it.
export interface SignInEmail {
  kind: "sign-in";
  to: string;
  url: string;
}

export type EmailMessage = SignInEmail;
