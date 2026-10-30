// The bindings vitest.config.ts gives the Worker, typed for `env` from cloudflare:workers.
declare namespace Cloudflare {
  interface Env {
    RESEND_API_KEY: string;
    MAIL_FROM: string;
  }
}
