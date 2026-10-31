#!/usr/bin/env node
// The wait list's launch send (ARCHITECTURE, Wait list): the operator runs it once, locally. It
// claims confirmed wait list rows with notified_at empty, a batch at a time, in one statement that
// also stores each row's unsubscribe token hash, and puts a launch email for each on the
// `email-bulk` queue through the Cloudflare Queues HTTP API. A batch whose push fails has
// notified_at cleared again, and the run stops. Rerunning it, or running two at once, queues no
// address twice. It prints how many confirmed addresses are still waiting.
//
//   DATABASE_URL=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
//   EMAIL_BULK_QUEUE_ID=... node scripts/launch-send.mjs
//
// Every secret comes from the environment: no .env file, no flag. The API token needs Queues
// Write. The script prints counts, an HTTP status or a Cloudflare error code, and nothing else:
// no address, link, token or raw error, since any of those can carry one.
// Exits 0 when no confirmed address is left waiting, 1 when the run stopped on an error, and 2
// when an environment variable is missing, before anything is touched.
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

const SITE = "https://rarepair.fans";
// The queue API's per-call cap on messages (Cloudflare Queues limits).
const BATCH_SIZE = 100;
// A push that takes longer is treated as failed. See "ambiguous push" in ARCHITECTURE.
const PUSH_TIMEOUT_MS = 30_000;

// apps/web's newToken: 32 random bytes, base64url, no padding.
const newToken = () => randomBytes(32).toString("base64url");
// apps/web's hashToken: lowercase hex SHA-256. The confirm and unsubscribe routes look a row up
// by this, so the two must agree.
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

// Claims up to $2 confirmed rows nobody has claimed, and gives the nth its nth hash from $1. One
// statement, so it is atomic: two runs at once never take a row twice, and `skip locked` passes
// over the rows the other holds instead of waiting for it. `for update` can't share a select with
// a window function, hence `picked` and then `numbered`.
const CLAIM = `
  with picked as (
    select email from waitlist
    where confirmed_at is not null and notified_at is null
    order by email limit $2 for update skip locked
  ), numbered as (
    select email, row_number() over (order by email) as n from picked
  ), hashes as (
    select h, n from unnest($1::text[]) with ordinality as t(h, n)
  )
  update waitlist w
  set notified_at = now(), unsubscribe_token_hash = hashes.h
  from numbered join hashes using (n)
  where w.email = numbered.email
  returning w.email, w.unsubscribe_token_hash`;

// A pg or fetch error can carry a value, so only a code or a name is ever printed.
const codeOf = (error) => {
  if (!(error instanceof Error)) return "unknown";
  // A DOMException's code is a legacy number: its name (AbortError, TimeoutError) says more.
  if (error instanceof DOMException) return error.name;
  // pg's errors carry a SQLSTATE and Node's a system code such as ECONNREFUSED.
  /** @type {Error & { code?: string }} */
  const withCode = error;
  return withCode.code ?? error.name;
};

/**
 * @typedef {object} LaunchSendOptions
 * @property {string} connectionString
 * @property {string} accountId
 * @property {string} queueId
 * @property {string} apiToken
 * @property {typeof fetch} [fetch]
 * @property {number} [batchSize]
 * @property {(line: string) => void} [log]
 * @property {AbortSignal} [signal] Stops the run: the batch in flight is cleared first.
 */

/**
 * Runs the send. Resolves with how many addresses it queued, how many confirmed addresses are
 * still waiting (null if that could not be counted), and a message for the operator when it
 * stopped on an error. It never rejects over a database or queue failure.
 * @param {LaunchSendOptions} options
 * @returns {Promise<{ queued: number, remaining: number | null, error: string | null }>}
 */
export async function launchSend({
  connectionString,
  accountId,
  queueId,
  apiToken,
  fetch: doFetch = globalThis.fetch,
  batchSize = BATCH_SIZE,
  log = console.log,
  signal,
}) {
  const client = new pg.Client({ connectionString });
  // A dropped connection is reported by the statement that was using it; without a listener the
  // client would also throw it unhandled.
  client.on("error", () => {});
  let queued = 0;
  let error = null;
  try {
    await client.connect();
    while (error === null && !signal?.aborted) {
      const tokens = Array.from({ length: batchSize }, newToken);
      const claimed = await client.query(CLAIM, [tokens.map(hashToken), batchSize]);
      if (claimed.rows.length === 0) break;
      const byHash = new Map(tokens.map((token) => [hashToken(token), token]));
      const rows = claimed.rows.map((row) => ({
        to: row.email,
        token: byHash.get(row.unsubscribe_token_hash),
      }));
      let pushed = false;
      try {
        const body = {
          messages: rows.map(({ to, token }) => ({
            body: {
              kind: "waitlist-launch",
              to,
              url: `${SITE}/waitlist/unsubscribe?token=${token}`,
            },
            content_type: "json",
          })),
        };
        error = await push(body);
        pushed = error === null;
      } finally {
        // Whatever stopped the push, even a throw, the batch's rows go back to waiting.
        if (!pushed) await release(client, rows, log);
      }
      if (pushed) {
        queued += rows.length;
        log(`queued ${queued} so far, ${await remainingOf(client)} still waiting`);
      }
    }
  } catch (caught) {
    error ??= `database error (${codeOf(caught)})`;
  }
  const remaining = await remainingOf(client);
  await client.end().catch(() => {});
  log(`${remaining ?? "unknown number of"} confirmed addresses still waiting`);
  return { queued, remaining, error };

  /** Pushes one batch. Resolves with null on success, or the reason it failed. */
  async function push(body) {
    let response;
    try {
      response = await doFetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/messages/batch`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.any([
            AbortSignal.timeout(PUSH_TIMEOUT_MS),
            ...(signal ? [signal] : []),
          ]),
        },
      );
    } catch (caught) {
      return `request failed (${codeOf(caught)})`;
    }
    if (!response.ok) return `HTTP ${response.status}`;
    // Cloudflare's reply: { success, errors: [{ code, message }] }. Only the codes are read.
    /** @type {{ success?: boolean, errors?: { code?: number }[] } | null} */
    let reply = null;
    try {
      reply = await response.json();
    } catch {
      return "unreadable reply";
    }
    if (reply?.success === true) return null;
    try {
      const codes = (reply?.errors ?? [])
        .map((e) => e.code)
        .filter((code) => Number.isInteger(code));
      if (codes.length > 0) return `Cloudflare error ${codes.join(", ")}`;
    } catch {
      // errors was not a list of objects: say only that it failed.
    }
    return "Cloudflare reported failure";
  }
}

// Puts a batch's rows back to waiting, so the next run claims them again. The hash stays: the next
// claim overwrites it. If this fails too, the rows stay marked notified with nothing queued:
// ARCHITECTURE, Wait list, has the statement that recovers them.
async function release(client, rows, log) {
  try {
    await client.query("update waitlist set notified_at = null where email = any($1::text[])", [
      rows.map((row) => row.to),
    ]);
  } catch (caught) {
    log(
      `could not release ${rows.length} claimed addresses (${codeOf(caught)}): see ARCHITECTURE, Wait list`,
    );
  }
}

async function remainingOf(client) {
  try {
    const { rows } = await client.query(
      "select count(*)::int as n from waitlist where confirmed_at is not null and notified_at is null",
    );
    return rows[0]?.n ?? null;
  } catch {
    return null;
  }
}

const NAMES = [
  "DATABASE_URL",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "EMAIL_BULK_QUEUE_ID",
];

async function main() {
  const missing = NAMES.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    for (const name of missing) console.error(`launch-send: ${name} is not set`);
    console.error(`usage: ${NAMES.join("=... ")}=... node scripts/launch-send.mjs`);
    return 2;
  }
  // A stop arrives as an abort, so the batch in flight is cleared before the process ends.
  const stop = new AbortController();
  for (const name of ["SIGINT", "SIGTERM"]) process.on(name, () => stop.abort());
  const { error } = await launchSend({
    connectionString: process.env.DATABASE_URL ?? "",
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
    queueId: process.env.EMAIL_BULK_QUEUE_ID ?? "",
    signal: stop.signal,
  });
  if (error === null && !stop.signal.aborted) return 0;
  console.error(`launch-send: stopped: ${error ?? "interrupted"}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
