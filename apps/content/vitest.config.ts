import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside workerd against the Worker's fetch entry and a local R2 bucket.
// The entry, compatibility date and R2 binding come from wrangler.jsonc, so the
// tests run the config that deploys.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    testTimeout: 60_000,
  },
});
