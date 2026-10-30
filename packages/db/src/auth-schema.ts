const timestamps = { createdAt: "created_at", updatedAt: "updated_at" } as const;

/**
 * Better Auth's model options mapping its camelCase fields onto our
 * snake_case columns. Spread into `betterAuth({ ...authSchema, ... })`.
 * A config that sets its own `user` (say, `additionalFields`) must merge
 * `authSchema.user` into it, or the `fields` mapping is lost.
 */
export const authSchema = {
  user: {
    fields: { emailVerified: "email_verified", ...timestamps },
  },
  session: {
    fields: {
      userId: "user_id",
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      ...timestamps,
    },
  },
  account: {
    fields: {
      userId: "user_id",
      accountId: "account_id",
      providerId: "provider_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      ...timestamps,
    },
  },
  verification: {
    fields: { expiresAt: "expires_at", ...timestamps },
  },
} as const;
