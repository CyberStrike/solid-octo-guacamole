import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker";

const RESEND_BATCH = "https://api.resend.com/emails/batch";

const signIn = (n: number) => ({
  kind: "sign-in",
  to: `reader${n}@example.test`,
  url: `https://rarepair.fans/login/confirm?token=link-${n}`,
});

function batchOf(bodies: unknown[]) {
  return createMessageBatch(
    "email",
    bodies.map((body, i) => ({ id: `msg-${i}`, timestamp: new Date(1000), attempts: 1, body })),
  );
}

async function consume(bodies: unknown[]) {
  const batch = batchOf(bodies);
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  return getQueueResult(batch, ctx);
}

function stubResend(respond: (emails: unknown[]) => Response) {
  const calls: { url: string; emails: unknown[] }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const emails = JSON.parse(String(init?.body)) as unknown[];
    calls.push({ url, emails });
    return respond(emails);
  });
  return calls;
}

const accepted = (emails: unknown[]) =>
  Response.json({ data: emails.map((_, i) => ({ id: `resend-${i}` })) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("01-auth-magic-link", () => {
  it("Sign-in emails go through Resend in batches", async () => {
    const calls = stubResend(accepted);

    const result = await consume([signIn(1), signIn(2), signIn(3)]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(RESEND_BATCH);
    expect(calls[0]!.emails).toHaveLength(3);
    expect(result.explicitAcks.sort()).toEqual(["msg-0", "msg-1", "msg-2"]);
    expect(result.retryMessages).toEqual([]);
  });
});

describe("mailer failures", () => {
  it("a batch every provider refuses is retried by the queue, not acked", async () => {
    stubResend(() => new Response("{}", { status: 503 }));

    const result = await consume([signIn(1), signIn(2)]);

    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages.map((m) => m.msgId).sort()).toEqual(["msg-0", "msg-1"]);
    expect(result.retryBatch.retry).toBe(false);
    expect(result.ackAll).toBe(false);
  });

  it("a message that breaks the contract is not sent and does not hold up the batch", async () => {
    const calls = stubResend(accepted);

    const result = await consume([
      signIn(1),
      { kind: "sign-in", to: "reader2@example.test" },
      { kind: "newsletter", to: "reader3@example.test", url: "https://rarepair.fans/" },
      { kind: "sign-in", to: "reader4@example.test", url: "javascript:alert(1)" },
      "not an object",
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.emails).toHaveLength(1);
    expect(result.explicitAcks.sort()).toEqual(["msg-0", "msg-1", "msg-2", "msg-3", "msg-4"]);
    expect(result.retryMessages).toEqual([]);
  });
});
