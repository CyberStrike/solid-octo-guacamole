import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The Worker's HTTP surface runs in workerd, through exports.default.fetch.
// The entry, compatibility date and bindings come from wrangler.jsonc, so the
// tests run the config that deploys. Postgres is the one the global setup
// starts, reached through a local Hyperdrive as in production.
export default defineConfig({
  plugins: [
    cloudflareTest(({ inject }) => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        hyperdrives: { HYPERDRIVE: inject("databaseUrl") },
      },
    })),
  ],
  test: {
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
