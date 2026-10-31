import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The Worker's HTTP surface runs in workerd, through exports.default.fetch.
// The entry, compatibility date and bindings come from wrangler.jsonc,
// so the tests run the config that deploys.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    projects: [
      {
        // The archive open: wrangler.jsonc with PRELAUNCH turned off.
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: { PRELAUNCH: "off" } },
          }),
        ],
        test: {
          name: "open",
          include: ["test/**/*.test.ts"],
          exclude: ["test/**/*.prelaunch.test.ts"],
        },
      },
      {
        // Before launch: wrangler.jsonc exactly as it deploys.
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: {
          name: "prelaunch",
          include: ["test/**/*.prelaunch.test.ts"],
        },
      },
    ],
  },
});
