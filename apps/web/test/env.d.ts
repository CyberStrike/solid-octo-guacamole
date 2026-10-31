// The Worker's bindings, typed for `env` from cloudflare:workers.
type WebEnv = import("../src/env").Env;

declare namespace Cloudflare {
  interface Env extends WebEnv {
    /** Test only: what the `email` queue delivered, from vitest.config.ts's email-sink. */
    EMAIL_SINK: Fetcher;
  }
}
