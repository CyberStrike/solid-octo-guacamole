import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Two projects (/tdd, Rules of the loop). Pure logic, such as the Turnstile
// verifier and the `next` reduction, runs in Node. The Worker's HTTP surface
// runs in workerd, through exports.default.fetch.
export default defineConfig({
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
