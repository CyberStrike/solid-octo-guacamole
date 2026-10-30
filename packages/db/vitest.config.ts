import { defineConfig } from "vitest/config";

// Node, not workerd: nothing here reaches a Workers-only API. Each test file
// starts its own in-process PGlite behind a local Postgres socket.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
