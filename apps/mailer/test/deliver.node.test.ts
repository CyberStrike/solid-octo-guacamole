import { describe, expect, it } from "vitest";
import { deliver } from "../src/deliver";
import type { OutgoingEmail, SendResult, Sender } from "../src/sender";

const email = (n: number): OutgoingEmail => ({
  from: "rarepair <sign-in@mail.example.test>",
  to: `reader${n}@example.test`,
  subject: "Your sign-in link for rarepair",
  text: `https://rarepair.fans/login/confirm?token=link-${n}`,
});

// A stub provider: records each batch it is given and answers with a fixed result.
function stubSender(name: string, result: SendResult) {
  const batches: OutgoingEmail[][] = [];
  const sender: Sender = {
    name,
    async sendBatch(emails) {
      batches.push(emails);
      return result;
    },
  };
  return { sender, batches };
}

describe("01-auth-magic-link", () => {
  it("Email sending fails over to the second provider", async () => {
    const resend = stubSender("resend", { outcome: "refused", status: 429 });
    const second = stubSender("second", { outcome: "sent", ids: ["second-1"] });

    const deliveries = await deliver([email(1)], [resend.sender, second.sender]);

    expect(second.batches).toEqual([[email(1)]]);
    expect(deliveries).toEqual([
      { sender: "second", result: { outcome: "sent", ids: ["second-1"] }, indexes: [0] },
    ]);
  });

  it("A failure that is not a refusal does not go to the second provider", async () => {
    const resend = stubSender("resend", { outcome: "failed", status: 422 });
    const second = stubSender("second", { outcome: "sent", ids: ["second-1"] });

    const deliveries = await deliver([email(1)], [resend.sender, second.sender]);

    expect(second.batches).toEqual([]);
    expect(deliveries).toEqual([
      { sender: "resend", result: { outcome: "failed", status: 422 }, indexes: [0] },
    ]);
  });
});
