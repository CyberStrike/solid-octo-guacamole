import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
// Cloudflare's published Turnstile test values: the always-pass secret and the dummy token.
const TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/**
 * The Worker's outbound network in tests: siteverify answers as Cloudflare does for
 * the test secret, and everything else is blocked. The dummy token passes for
 * rarepair.fans, or for the host after an "@" ("XXXX.DUMMY.TOKEN.XXXX@other.example");
 * "siteverify-down" gets a 503; any other token fails.
 */
async function outbound(request: Request): Promise<Response> {
  if (request.url !== SITEVERIFY) {
    return new Response("outbound network blocked in tests", { status: 599 });
  }
  const form = new URLSearchParams(await request.text());
  const [token, hostname = "rarepair.fans"] = (form.get("response") ?? "").split("@");
  if (token === "siteverify-down") return new Response("unavailable", { status: 503 });
  if (form.get("secret") === TURNSTILE_SECRET_KEY && token === DUMMY_TOKEN) {
    return Response.json({ success: true, hostname, "error-codes": [] });
  }
  return Response.json({ success: false, "error-codes": ["invalid-input-response"] });
}

// Stands in for apps/mailer as the `email` queue's consumer, and answers a fetch
// with every message body it has been delivered. One message a batch, delivered at once.
const EMAIL_SINK = /* js */ `
const delivered = [];
export default {
  async queue(batch) {
    for (const message of batch.messages) {
      delivered.push(message.body);
      message.ack();
    }
  },
  async fetch() {
    return Response.json(delivered);
  },
};
`;

// Two projects (/tdd, Rules of the loop). Pure logic, such as the Turnstile
// verifier and the `next` reduction, runs in Node. The Worker's HTTP surface
// runs in workerd, through exports.default.fetch.
export default defineConfig({
  // The plugin resolves a module workerd asks it for through this root config's
  // SSR environment, not the workers project's: pg's require of pg-cloudflare
  // needs the plugin's conditions here too. The node project doesn't inherit them.
  ssr: { resolve: { conditions: ["workerd", "worker", "module", "browser"] } },
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    projects: [
      {
        test: {
          name: "node",
          include: ["test/**/*.node.test.ts"],
          environment: "node",
        },
      },
      {
        plugins: [
          // The entry, compatibility date and bindings come from wrangler.jsonc, so
          // the tests run the config that deploys. Postgres is the one the global
          // setup starts, reached through a local Hyperdrive as in production.
          cloudflareTest(({ inject }) => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              hyperdrives: { HYPERDRIVE: inject("databaseUrl") },
              outboundService: outbound,
              bindings: {
                // Throwaway test values, not credentials.
                BETTER_AUTH_SECRET: "test-only-auth-value-not-used-anywhere-else",
                TURNSTILE_SECRET_KEY,
              },
              serviceBindings: { EMAIL_SINK: "email-sink" },
              workers: [
                {
                  name: "email-sink",
                  modules: true,
                  script: EMAIL_SINK,
                  compatibilityDate: "2026-08-01",
                  queueConsumers: { email: { maxBatchSize: 1, maxBatchTimeout: 0 } },
                },
              ],
            },
          })),
        ],
        test: {
          name: "workers",
          include: ["test/**/*.test.ts"],
          exclude: ["test/**/*.node.test.ts"],
          globalSetup: ["./test/global-setup.ts"],
        },
      },
    ],
  },
});
