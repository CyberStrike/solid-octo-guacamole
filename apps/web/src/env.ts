/** The web Worker's bindings, from wrangler.jsonc. */
export interface Env {
  /** Neon Postgres. */
  HYPERDRIVE: Hyperdrive;
  /** The queue apps/mailer sends from. */
  EMAIL: Queue<SignInEmail>;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  /** Signs Better Auth's session cookies. */
  BETTER_AUTH_SECRET: string;
}

// A copy of the `email` queue's contract, which lives with its consumer in
// apps/mailer/src/message.ts (an app this one can't import). Keep the two in step.
export interface SignInEmail {
  kind: "sign-in";
  to: string;
  url: string;
}
