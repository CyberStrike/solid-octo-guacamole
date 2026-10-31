// The `email` queue's contract lives with its consumer. A type-only import: of
// apps/mailer, the Worker bundles only the address rule waitlist.ts imports.
import type { EmailMessage } from "../../mailer/src/message";

/** The web Worker's bindings, vars and secrets (wrangler.jsonc). */
export type Bindings = {
  PRELAUNCH?: string;
  TURNSTILE_SITE_KEY: string;
  ASSETS: Fetcher;
  /** Neon Postgres. */
  HYPERDRIVE: Hyperdrive;
  /** The queue apps/mailer sends from. */
  EMAIL: Queue<EmailMessage>;
  /** `POST /login` requests per client IP (src/rate-limit.ts). */
  LOGIN_IP_LIMIT: RateLimit;
  /** `POST /login` requests per email address (src/rate-limit.ts). */
  LOGIN_EMAIL_LIMIT: RateLimit;
  TURNSTILE_SECRET_KEY: string;
  /** Signs Better Auth's session cookies. */
  BETTER_AUTH_SECRET: string;
};
