import { deliver } from "./deliver";
import { parseMessage } from "./message";
import { render } from "./render";
import { resendSender } from "./resend";
import type { OutgoingEmail } from "./sender";

export interface Env {
  RESEND_API_KEY: string;
  MAIL_FROM: string;
}

export default {
  async queue(batch, env, _ctx) {
    const valid: Message[] = [];
    const emails: OutgoingEmail[] = [];
    for (const message of batch.messages) {
      const parsed = parseMessage(message.body);
      if (parsed === null) {
        message.ack();
        continue;
      }
      valid.push(message);
      emails.push(render(parsed, env.MAIL_FROM));
    }

    // Logs carry provider message IDs, outcomes and counts only: never an address, a link,
    // a message body, a provider's response body or an error's text (ARCHITECTURE, Auth, Email).
    const invalid = batch.messages.length - valid.length;
    if (invalid > 0) console.warn({ event: "email.invalid", count: invalid });
    if (emails.length === 0) return;

    // Only Resend for now: the failover provider is still to be chosen.
    const { sender, result } = await deliver(emails, [resendSender(env.RESEND_API_KEY)]);
    const line = { event: "email.send", provider: sender, count: emails.length };
    if (result.outcome === "sent") console.log({ ...line, outcome: "sent", ids: result.ids });
    else console.error({ ...line, outcome: result.outcome, status: result.status });

    // Ack and retry per message: a retried message is dead-lettered after max_retries.
    for (const message of valid) {
      if (result.outcome === "sent") message.ack();
      else message.retry();
    }
  },
} satisfies ExportedHandler<Env>;
