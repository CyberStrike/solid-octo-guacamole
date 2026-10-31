// The Worker's bindings, typed for `env` from cloudflare:workers.
type WebEnv = import("../src/env").Env;

declare namespace Cloudflare {
  interface Env extends WebEnv {}
}
