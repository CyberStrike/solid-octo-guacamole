import { authSchema, type Database } from "@archive/db";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import type { Kysely } from "kysely";
import type { Env } from "./env";
import { LINK_LIFETIME_MINUTES, SITE } from "./signin";

/**
 * Better Auth, built per request: bindings only exist inside one, and a
 * per-request instance shares no in-process state with another isolate's
 * (ARCHITECTURE, Auth). Our routes call `auth.api.*`; `auth.handler`, with
 * Better Auth's own JSON endpoints, is not mounted.
 */
export function makeAuth(env: Env, db: Kysely<Database>) {
  return betterAuth({
    ...authSchema,
    // Fixed, never the request's host: sign-in links always go to rarepair.fans.
    baseURL: SITE,
    trustedOrigins: [SITE],
    secret: env.BETTER_AUTH_SECRET,
    database: { db, type: "postgres" },
    telemetry: { enabled: false },
    // Counters in Postgres, not in this isolate's memory. Only `auth.handler`
    // requests are counted, so `auth.api` calls from our routes never are: their
    // own per-IP and per-email limits use the Workers rate-limiting binding (A3, #23).
    rateLimit: { ...authSchema.rateLimit, storage: "database" },
    advanced: {
      // __Secure- cookies. No crossSubDomainCookies: no Domain, so never content.rarepair.fans.
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    plugins: [
      magicLink({
        storeToken: "hashed",
        expiresIn: LINK_LIFETIME_MINUTES * 60,
        // Never logs its arguments: they hold the address and the link.
        sendMagicLink: async ({ email, token, metadata }) => {
          const link = new URL("/login/confirm", SITE);
          link.searchParams.set("token", token);
          // SAFETY: our route always passes metadata.next, a string from safeNext.
          link.searchParams.set("next", (metadata?.next as string | undefined) ?? "/");
          await env.EMAIL.send({ kind: "sign-in", to: email, url: link.href });
        },
      }),
    ],
  });
}
