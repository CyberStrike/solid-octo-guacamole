import { deliver } from "./deliver";
import type { EmailMessage } from "./message";
import { render } from "./render";
import { resendSender } from "./resend";

export interface Env {
  RESEND_API_KEY: string;
  MAIL_FROM: string;
}

export default {
  async queue(batch, env, _ctx) {
    const messages = batch.messages;
    const emails = messages.map((m) => render(m.body as EmailMessage, env.MAIL_FROM));
    const deliveries = await deliver(emails, [resendSender(env.RESEND_API_KEY)]);
    for (const d of deliveries) {
      for (const i of d.indexes) {
        if (d.result.outcome === "sent") messages[i]!.ack();
        else messages[i]!.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
