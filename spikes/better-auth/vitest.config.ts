import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Same pattern as packages/epub, plus: a Worker entry, a local D1 database, and
// nodejs_compat (Better Auth needs AsyncLocalStorage from node:async_hooks).
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/worker.ts",
      miniflare: {
        compatibilityDate: "2026-08-01",
        // Note: the plugin injects nodejs_compat_v2 into the test runner regardless
        // (vitest-plugin dist/pool/index.mjs ~70223), so dropping this flag
        // locally proves nothing. Production needs it (or a date >= 2026-08-04).
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        bindings: {
          BASE_URL: "https://archive.test",
          // Throwaway test secret, not a real credential.
          AUTH_SECRET: "spike-only-secret-0123456789abcdef0123456789abcdef",
        },
      },
    }),
  ],
  test: {
    testTimeout: 60_000,
  },
});
