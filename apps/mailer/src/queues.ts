import { parseMessage, type EmailMessage } from "./message";

export const BULK_QUEUE = "email-bulk";

/** The kinds each queue carries (ARCHITECTURE, Auth, Email: Two queues). */
const KINDS: Record<string, readonly EmailMessage["kind"][]> = {
  email: ["sign-in", "waitlist-confirm"],
  [BULK_QUEUE]: ["waitlist-launch"],
};

/**
 * parseMessage, for the queue the body came off: a kind on the other queue is refused like any
 * other bad body. The launch email is sent only from `email-bulk`, where it is paced.
 */
export function parseForQueue(queue: string, body: unknown): EmailMessage | null {
  const parsed = parseMessage(body);
  return parsed !== null && KINDS[queue]?.includes(parsed.kind) ? parsed : null;
}
