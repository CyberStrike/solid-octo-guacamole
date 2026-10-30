// An email ready for a provider: the mailer has rendered it and set `from`.
export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

// What a provider made of one batch call.
// - sent: accepted; `ids` are the provider's message IDs, by index.
// - refused: rate limit, quota or outage. Another provider may take the batch.
// - failed: anything else (a bad request, a bad key). Another provider would fare no better.
export type SendResult =
  | { outcome: "sent"; ids: string[] }
  | { outcome: "refused"; status: number }
  | { outcome: "failed"; status: number };

export interface Sender {
  readonly name: string;
  sendBatch(emails: OutgoingEmail[]): Promise<SendResult>;
}
