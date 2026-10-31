// Tests for scripts/r2-bucket-rules.mjs, run with node:test: `npm run test:scripts`. Each
// scenario file is a top-level test and each case a subtest, awaited, as node:test's promises ask.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lifecycleRules } from "./r2-bucket-rules.mjs";

await test("02-upload-handshake", async (t) => {
  await t.test("Confirm is never called", () => {
    assert.deepEqual(lifecycleRules(), {
      rules: [
        {
          id: "expire-uploads",
          enabled: true,
          conditions: { prefix: "uploads/" },
          deleteObjectsTransition: { condition: { type: "Age", maxAge: 604800 } },
        },
      ],
    });
  });
});
