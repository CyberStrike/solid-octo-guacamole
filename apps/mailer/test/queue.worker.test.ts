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

// Everything the Worker wrote to the console during one queue run, as text.
function captureLogs() {
  const lines: string[] = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  return lines;
}

describe("mailer logs", () => {
  it("logs the provider, outcome and provider message IDs of each send", async () => {
    stubResend(accepted);
    const logs = captureLogs();

    await consume([signIn(1), signIn(2)]);

    const text = logs.join("\n");
    expect(text).toContain("resend");
    expect(text).toContain("sent");
    expect(text).toContain("resend-0");
    expect(text).toContain("resend-1");
  });

  it.each([
    ["sent", () => accepted],
    ["refused", () => () => new Response('{"message":"reader1@example.test"}', { status: 429 })],
    ["failed", () => () => new Response('{"message":"reader1@example.test"}', { status: 422 })],
  ] as const)("never logs an address or a link when the batch is %s", async (_, respond) => {
    stubResend(respond());
    const logs = captureLogs();

    await consume([
      signIn(1),
      { kind: "sign-in", to: "reader9@example.test", url: "http://x.test/" },
    ]);

    const text = logs.join("\n");
    expect(logs.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/@example\.test/);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toContain("link-1");
  });

  it("never logs an address or a link when the provider cannot be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError(
        "could not reach reader1@example.test for https://rarepair.fans/login/confirm?token=link-1",
      ),
    );
    const logs = captureLogs();

    await consume([signIn(1)]);

    const text = logs.join("\n");
    expect(logs.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/@example\.test/);
    expect(text).not.toMatch(/https?:\/\//);
  });
});

describe("test setup", () => {
  it("a fetch no test stubbed never reaches Resend", async () => {
    const res = await fetch(RESEND_BATCH, { method: "POST", body: "[]" });
    expect(res.status).toBe(599);
    await res.body?.cancel();
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
      {
        kind: "sign-in",
        to: "reader5@example.test",
        url: "https://evil.example/login/confirm?token=x",
      },
      { kind: "sign-in", to: "reader6@example.test", url: "https://rarepair.fans/upload" },
      {
        kind: "sign-in",
        to: "reader7@example.test",
        url: "https://evil.example@rarepair.fans/login/confirm?token=x",
      },
      { kind: "sign-in", to: "Support<reader8@example.test>", url: signIn(8).url },
      { kind: "sign-in", to: "reader9@example.test,other@example.test", url: signIn(9).url },
      { kind: "sign-in", to: `${"a".repeat(250)}@example.test`, url: signIn(10).url },
      { kind: "sign-in", to: "reader11@example.test", url: `${signIn(11).url}${"x".repeat(2048)}` },
      { kind: "sign-in", to: "reader12@example.test", url: `${signIn(12).url}#more` },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.emails).toHaveLength(1);
    expect(result.explicitAcks).toHaveLength(13);
    expect(result.explicitAcks).toContain("msg-0");
    expect(result.retryMessages).toEqual([]);
  });

  it("a link with line breaks in it cannot add lines to the email", async () => {
    const calls = stubResend(accepted);

    await consume([
      {
        kind: "sign-in",
        to: "reader1@example.test",
        url: "https://rarepair.fans/login/confirm?token=x\n\nInjected line\n",
      },
    ]);

    const [sent] = calls[0]!.emails as { text: string }[];
    expect(sent!.text).not.toContain("\nInjected line");
    expect(sent!.text).toContain("https://rarepair.fans/login/confirm?token=xInjected%20line");
  });
});
