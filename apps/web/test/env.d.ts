import type { Bindings } from "../src/prelaunch";

// The env the tests see from cloudflare:workers: the Worker's own bindings (wrangler.jsonc).
declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}
