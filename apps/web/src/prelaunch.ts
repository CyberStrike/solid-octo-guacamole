/** The web Worker's bindings and vars (wrangler.jsonc). */
export type Bindings = {
  PRELAUNCH?: string;
  TURNSTILE_SITE_KEY: string;
  ASSETS: Fetcher;
};

/**
 * Whether the archive is still closed (ARCHITECTURE, Wait list). Only "off" opens it,
 * so a missing or misspelt setting fails closed.
 */
export const isPrelaunch = (env: Pick<Bindings, "PRELAUNCH">) => env.PRELAUNCH !== "off";
