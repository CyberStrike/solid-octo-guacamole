import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside workerd because HTMLRewriter only exists there.
// The compatibility date must not be newer than the installed workerd.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        // No nodejs_compat: the library only uses Web APIs, fflate and fast-xml-parser.
        compatibilityDate: "2026-08-01",
      },
    }),
  ],
  test: {
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 60_000,
  },
});
