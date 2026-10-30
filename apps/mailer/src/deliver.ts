import type { OutgoingEmail, SendResult, Sender } from "./sender";

// Resend takes at most 100 emails per batch call.
const MAX_PER_CALL = 100;

export interface Delivery {
  sender: string;
  result: SendResult;
  // Indexes into the emails passed to deliver().
  indexes: number[];
}

// Sends the emails in as few calls as the providers allow.
export async function deliver(emails: OutgoingEmail[], senders: Sender[]): Promise<Delivery[]> {
  const deliveries: Delivery[] = [];
  for (let start = 0; start < emails.length; start += MAX_PER_CALL) {
    const chunk = emails.slice(start, start + MAX_PER_CALL);
    const indexes = chunk.map((_, i) => start + i);
    deliveries.push({ ...(await sendWithFailover(chunk, senders)), indexes });
  }
  return deliveries;
}

// Tries each provider in order. Only a refusal moves on to the next one.
async function sendWithFailover(emails: OutgoingEmail[], senders: Sender[]) {
  let last: { sender: string; result: SendResult } | null = null;
  for (const sender of senders) {
    last = { sender: sender.name, result: await sender.sendBatch(emails) };
    if (last.result.outcome !== "refused") break;
  }
  return last!;
}
