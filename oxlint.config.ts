// One config for the whole repo: `npm run lint` walks every workspace and `scripts/` from here.
// A TypeScript config, so ai-deslop's preset is spread live rather than copied. It needs
// Node 22.18+ or 24+.
//
// Every rule turned off below says why, and only for the files named. A single line that a rule
// misreads gets `// oxlint-disable-next-line <rule> -- <reason>` instead; `npm run lint` reports
// any such comment that no longer suppresses anything.
import { defineConfig } from "oxlint";
import { configs as deslopConfigs } from "ai-deslop";

export default defineConfig({
  jsPlugins: ["ai-deslop"],
  // typeAware runs through oxlint-tsgolint, one program per workspace tsconfig.
  options: deslopConfigs.recommended.options,
  rules: deslopConfigs.recommended.rules,
  ignorePatterns: [
    // Reference code with its own lockfile, not a workspace.
    "spikes/**",
    // Test inputs, specs and prose: not code.
    "fixtures/**",
    "specs/**",
    "docs/**",
    // Merged migrations are history and are never edited.
    "packages/db/migrations/**",
  ],
  overrides: [
    {
      // The OPF, NCX and nav readers. fast-xml-parser returns untyped trees from hostile input,
      // and these functions are where that input is validated.
      files: ["packages/epub/src/package.ts"],
      rules: {
        // child/attr/text take whatever node the parser produced and check it themselves.
        "deslop/no-unknown-parameters": "off",
        // typeof is how each reader checks a parser value before using it.
        "deslop/no-runtime-typeof": "off",
        // XmlNode and OrderedNode are the parser's own open records; no schema exists to derive.
        "deslop/no-unsafe-dictionary-type": "off",
        // Each assertion widens parser output to those records, which every reader rechecks.
        "deslop/require-safety-comment-for-type-assertion": "off",
      },
    },
    {
      // The queue message contract and Resend's answer: both validate a body from outside.
      files: ["apps/mailer/src/message.ts", "apps/mailer/src/resend.ts"],
      rules: {
        // parseMessage and messageIds take the raw body; checking it is their job.
        "deslop/no-unknown-parameters": "off",
        // typeof is how they check each field of that body.
        "deslop/no-runtime-typeof": "off",
      },
    },
    {
      files: ["apps/mailer/src/message.ts"],
      rules: {
        // The raw message's fields, read before any of them is trusted.
        "deslop/no-unsafe-dictionary-type": "off",
      },
    },
    {
      // No tsconfig covers scripts/, so tsgolint reads these plain JS files with default
      // compiler options, under which an array element is never undefined: every `??` fallback
      // in them reads as unnecessary.
      files: ["scripts/**"],
      rules: {
        "typescript/no-unnecessary-condition": "off",
      },
    },
  ],
});
