import type { OutgoingEmail, SendResult, Sender } from "./sender";

const BATCH_URL = "https://api.resend.com/emails/batch";

// Resend's batch API: one call for up to 100 emails.
// https://resend.com/docs/api-reference/emails/send-batch-emails
export function resendSender(apiKey: string, fetcher: typeof fetch = (...a) => fetch(...a)): Sender {
  return {
    name: "resend",
    async sendBatch(emails: OutgoingEmail[]): Promise<SendResult> {
      const res = await fetcher(BATCH_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(emails),
      });
      if (res.ok) {
        const body = (await res.json()) as { data?: { id: string }[] };
        return { outcome: "sent", ids: (body.data ?? []).map((d) => d.id) };
      }
      // The body is never read on failure: providers echo the recipient in error messages.
      await res.body?.cancel();
      return { outcome: "failed", status: res.status };
    },
  };
}
