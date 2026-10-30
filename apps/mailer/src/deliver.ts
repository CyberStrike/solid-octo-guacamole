import type { OutgoingEmail, SendResult, Sender } from "./sender";

export interface Delivery {
  sender: string;
  result: SendResult;
}

// Sends the emails of one queue batch in one call, trying each provider in order.
// Only a refusal moves on to the next provider. A queue batch holds at most 100 messages,
// which is also the most Resend takes in one call.
export async function deliver(
  emails: OutgoingEmail[],
  senders: readonly [Sender, ...Sender[]],
): Promise<Delivery> {
  let delivery!: Delivery;
  for (const sender of senders) {
    delivery = { sender: sender.name, result: await sender.sendBatch(emails) };
    if (delivery.result.outcome !== "refused") break;
  }
  return delivery;
}
