import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The Worker's HTTP surface runs in workerd, through exports.default.fetch.
// No bindings yet: A1 adds the database and nodejs_compat.
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2026-08-01",
      },
    }),
  ],
  test: {
    testTimeout: 60_000,
  },
});
