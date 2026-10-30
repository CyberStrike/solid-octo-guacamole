import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The Worker's HTTP surface runs in workerd, through exports.default.fetch.
// The entry, compatibility date and (later) bindings come from wrangler.jsonc,
// so the tests run the config that deploys.
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
