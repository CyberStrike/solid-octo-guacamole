import type { OutgoingEmail, SendResult, Sender } from "./sender";

const BATCH_URL = "https://api.resend.com/emails/batch";

// Resend's batch API: one call for up to 100 emails.
// https://resend.com/docs/api-reference/emails/send-batch-emails
export function resendSender(apiKey: string, fetcher: typeof fetch = (...a) => fetch(...a)): Sender {
  return {
    name: "resend",
    async sendBatch(emails: OutgoingEmail[]): Promise<SendResult> {
      let res: Response;
      try {
        res = await fetcher(BATCH_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(emails),
        });
      } catch {
        // A network error is an outage. The error is dropped: it may echo the request.
        return { outcome: "refused", status: 0 };
      }
      if (res.ok) {
        const body = (await res.json()) as { data?: { id: string }[] };
        return { outcome: "sent", ids: (body.data ?? []).map((d) => d.id) };
      }
      // The body is never read on failure: providers echo the recipient in error messages.
      await res.body?.cancel();
      // A refusal is a rate limit, a quota (both 429) or an outage (5xx).
      // https://resend.com/docs/api-reference/errors
      if (res.status === 429 || res.status >= 500) return { outcome: "refused", status: res.status };
      return { outcome: "failed", status: res.status };
    },
  };
}
