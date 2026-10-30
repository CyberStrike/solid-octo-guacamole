import { describe, expect, it } from "vitest";
import { resendSender } from "../src/resend";
import type { OutgoingEmail } from "../src/sender";

const email: OutgoingEmail = {
  from: "rarepair <sign-in@mail.example.test>",
  to: "reader@example.test",
  subject: "Your sign-in link for rarepair",
  text: "https://rarepair.fans/login/confirm?token=link-1",
};

const answering = (res: () => Response): typeof fetch => async () => res();

describe("Resend batch sender", () => {
  it("posts the emails as one JSON array with the API key", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      seen = { url: String(input), init };
      return Response.json({ data: [{ id: "resend-1" }] });
    };

    const result = await resendSender("re_test_key", fetcher).sendBatch([email]);

    expect(result).toEqual({ outcome: "sent", ids: ["resend-1"] });
    expect(seen?.url).toBe("https://api.resend.com/emails/batch");
    expect(seen?.init?.method).toBe("POST");
    expect(new Headers(seen?.init?.headers).get("authorization")).toBe("Bearer re_test_key");
    expect(JSON.parse(String(seen?.init?.body))).toEqual([email]);
  });

  // Rate limit, quota or outage (Resend's error codes: 429 for rate and quota, 5xx).
  it.each([429, 500, 503])("a %i is a refusal", async (status) => {
    const sender = resendSender("re_test_key", answering(() => new Response("{}", { status })));
    expect(await sender.sendBatch([email])).toEqual({ outcome: "refused", status });
  });

  it("a network error is a refusal", async () => {
    const sender = resendSender("re_test_key", async () => {
      throw new TypeError("network down");
    });
    expect(await sender.sendBatch([email])).toEqual({ outcome: "refused", status: 0 });
  });

  it.each([400, 401, 403, 422])("a %i is a failure, not a refusal", async (status) => {
    const sender = resendSender("re_test_key", answering(() => new Response("{}", { status })));
    expect(await sender.sendBatch([email])).toEqual({ outcome: "failed", status });
  });
});
