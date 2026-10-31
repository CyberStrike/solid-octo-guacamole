import type { OutgoingEmail, SendResult, Sender } from "./sender";

const BATCH_URL = "https://api.resend.com/emails/batch";

// One consumer runs at a time (max_concurrency 1), so a call that hangs would hold up every
// sign-in email behind it.
const TIMEOUT_MS = 10_000;

// The provider message IDs from an accepted batch's answer. These are logged, so anything that
// doesn't look like an ID (Resend's are UUIDs) is left out rather than trusted.
// oxlint-disable-next-line deslop/no-unknown-parameters -- the raw answer body; checking it is this function's job
function messageIds(body: unknown): string[] {
  // SAFETY: the optional chain reads `data` off any value, and the next line checks it.
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  // SAFETY: the same for each entry's `id`, which the filter checks.
  return (
    data
      .map((d) => (d as { id?: unknown } | null)?.id)
      // oxlint-disable-next-line deslop/no-runtime-typeof -- how an untrusted id is checked before it is logged
      .filter((id): id is string => typeof id === "string" && /^[\w-]{1,64}$/.test(id))
  );
}

// Resend's batch API: one call for up to 100 emails.
// https://resend.com/docs/api-reference/emails/send-batch-emails
export function resendSender(
  apiKey: string,
  fetcher: typeof fetch = (...a) => fetch(...a),
  timeoutMs = TIMEOUT_MS,
): Sender {
  return {
    name: "resend",
    async sendBatch(emails: OutgoingEmail[]): Promise<SendResult> {
      let res: Response;
      try {
        res = await fetcher(BATCH_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(emails),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // A network error or a timeout is an outage. The error is dropped: it may echo the request.
        return { outcome: "refused", status: 0 };
      }
      if (res.ok) {
        // Accepted, so it is sent even when the answer can't be read: retrying would send it twice.
        const body: unknown = await res.json().catch(() => null);
        return { outcome: "sent", ids: messageIds(body) };
      }
      // The body is never read on failure: providers echo the recipient in error messages.
      await res.body?.cancel().catch(() => {});
      // A refusal is a rate limit, a quota (both 429) or an outage (5xx).
      // https://resend.com/docs/api-reference/errors
      if (res.status === 429 || res.status >= 500)
        return { outcome: "refused", status: res.status };
      return { outcome: "failed", status: res.status };
    },
  };
}
