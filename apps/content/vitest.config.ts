import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside workerd against the Worker's fetch entry and a local R2 bucket.
// The compatibility date must not be newer than the installed workerd.
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2026-08-01",
        r2Buckets: ["BUCKET"],
      },
    }),
  ],
  test: {
    testTimeout: 60_000,
  },
});
