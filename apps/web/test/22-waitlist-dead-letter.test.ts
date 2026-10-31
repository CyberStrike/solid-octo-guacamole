import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createDb } from "@archive/db";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { deadLetteredLaunchEmails } from "../src/launch-dead-letter";

// Runs in the "open" project. The handler is imported, as apps/mailer's tests import theirs:
// the Worker's default export carries it as `queue` for Cloudflare to call.

const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
afterAll(() => db.destroy());

const NOTIFIED = new Date("2026-11-01T10:00:00Z");

// A confirmed address the launch send has queued: notified_at set.
async function queuedAddress(email: string) {
  await db
    .insertInto("waitlist")
    .values({ email, confirmed_at: NOTIFIED, notified_at: NOTIFIED })
    .execute();
}

const notifiedAt = async (email: string) =>
  (
    await db
      .selectFrom("waitlist")
      .select("notified_at")
      .where("email", "=", email)
      .executeTakeFirstOrThrow()
  ).notified_at;

const launch = (to: string) => ({
  kind: "waitlist-launch",
  to,
  url: "https://rarepair.fans/waitlist/unsubscribe?token=bye-token",
});

async function deliver(bodies: unknown[], bindings: Pick<Cloudflare.Env, "HYPERDRIVE"> = env) {
  const batch = createMessageBatch(
    "email-bulk-dlq",
    bodies.map((body, i) => ({ id: `msg-${i}`, timestamp: new Date(1000), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await deadLetteredLaunchEmails(batch, bindings, ctx);
  return getQueueResult(batch, ctx);
}

function captureLogs() {
  const lines: string[] = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      // oxlint-disable-next-line deslop/no-runtime-typeof -- console takes any value; strings print bare
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("22-waitlist", () => {
  it("A launch email that can't be sent is tried again", async () => {
    await queuedAddress("dead1@example.test");
    await queuedAddress("dead2@example.test");
    await queuedAddress("sent@example.test");
    const logs = captureLogs();

    const result = await deliver([launch("dead1@example.test"), launch("dead2@example.test")]);

    // Cleared, so the launch send queues them again; the address that was sent is left alone.
    expect(await notifiedAt("dead1@example.test")).toBeNull();
    expect(await notifiedAt("dead2@example.test")).toBeNull();
    expect(await notifiedAt("sent@example.test")).toEqual(NOTIFIED);
    // Not kept on the dead-letter queue.
    expect(result.ackAll).toBe(true);
    expect(result.retryMessages).toEqual([]);
    // Counts only: no address in logs.
    const text = logs.join("\n");
    expect(text).toContain("waitlist.launch-dead-letter");
    expect(text).not.toContain("example.test");
  });

  it("acks a body that is not a launch email, and clears nothing for it", async () => {
    await queuedAddress("keep@example.test");
    const logs = captureLogs();

    const result = await deliver([
      "not an object",
      {
        kind: "sign-in",
        to: "keep@example.test",
        url: "https://rarepair.fans/login/confirm?token=a",
      },
      { kind: "waitlist-launch", to: "keep@example.test", url: "https://evil.example/x" },
    ]);

    expect(await notifiedAt("keep@example.test")).toEqual(NOTIFIED);
    expect(result.ackAll).toBe(true);
    expect(logs.join("\n")).not.toContain("example.test");
  });

  it("retries the batch, and logs no address, when the database can't be reached", async () => {
    const logs = captureLogs();
    // SAFETY: the handler reads only HYPERDRIVE.connectionString, which this stand-in has; the
    // port is closed, so connecting fails.
    const unreachable = {
      HYPERDRIVE: { connectionString: "postgresql://nobody:nothing@127.0.0.1:1/none" },
    } as Pick<Cloudflare.Env, "HYPERDRIVE">;

    const result = await deliver([launch("lost@example.test")], unreachable);

    expect(result.ackAll).toBe(false);
    expect(result.retryBatch.retry).toBe(true);
    expect(logs.join("\n")).not.toContain("example.test");
  });
});
