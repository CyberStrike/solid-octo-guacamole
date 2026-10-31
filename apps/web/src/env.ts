// The `email` queue's contract lives with its consumer. A type-only import: nothing
// of apps/mailer is bundled into this Worker.
import type { EmailMessage } from "../../mailer/src/message";

/** The web Worker's bindings, from wrangler.jsonc. */
export interface Env {
  /** Neon Postgres. */
  HYPERDRIVE: Hyperdrive;
  /** The queue apps/mailer sends from. */
  EMAIL: Queue<EmailMessage>;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  /** Signs Better Auth's session cookies. */
  BETTER_AUTH_SECRET: string;
}
