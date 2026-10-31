// One config for the whole repo: `npm run lint` walks every workspace and `scripts/` from here.
// A TypeScript config, so ai-deslop's preset is spread live rather than copied. It needs
// Node 22.18+ or 24+.
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
});
