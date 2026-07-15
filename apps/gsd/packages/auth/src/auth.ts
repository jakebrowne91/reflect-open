import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "next-runtime-env";

import type { dbClient } from "@kan/db/client";
import * as schema from "@kan/db/schema";

import { sendAuthEmail } from "./email";
import { createDatabaseHooks, createMiddlewareHooks } from "./hooks";
import { createPlugins } from "./plugins";
import { configuredProviders } from "./providers";

export const initAuth = (db: dbClient) => {
  const baseURL = env("NEXT_PUBLIC_BASE_URL") || env("BETTER_AUTH_URL");
  const trustedOrigins =
    env("BETTER_AUTH_TRUSTED_ORIGINS")?.split(",").filter(Boolean) ?? [];

  return betterAuth({
    secret: env("BETTER_AUTH_SECRET"),
    baseURL,
    trustedOrigins: [...(baseURL ? [baseURL] : []), ...trustedOrigins],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        ...schema,
        user: schema.users,
      },
    }),
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24 * 2, // Update session expiry every 48 hours if user is active
      freshAge: 0,
    },
    emailAndPassword: {
      enabled: env("NEXT_PUBLIC_ALLOW_CREDENTIALS")?.toLowerCase() === "true",
      // Sign-up restriction is handled by the user.create.before database
      // hook which checks for pending invitations, allowing invited users
      // to register even when public sign-up is disabled.
      disableSignUp: false,
      sendResetPassword: async (data) => {
        await sendAuthEmail(
          data.user.email,
          "Reset Password",
          "RESET_PASSWORD",
          {
            resetPasswordUrl: data.url,
            resetPasswordToken: data.token,
          },
        );
      },
    },
    socialProviders: configuredProviders,
    user: {
      deleteUser: {
        enabled: true,
      },
      additionalFields: {
        stripeCustomerId: {
          type: "string",
          required: false,
          defaultValue: null,
          input: false,
        },
      },
    },
    plugins: createPlugins(db),
    databaseHooks: createDatabaseHooks(db),
    hooks: createMiddlewareHooks(db),
    advanced: {
      cookiePrefix: env("BETTER_AUTH_COOKIE_PREFIX") || "gsd",
      database: {
        generateId: false,
      },
      // When GSD is embedded in Reflect (a different origin), the session
      // cookie is third-party. SameSite=None + Secure lets the browser send
      // it inside the frame, and Partitioned (CHIPS) keeps it allowed even
      // with third-party cookies blocked — the in-frame login stops bouncing.
      // Gated on GSD_EMBED_COOKIES so a standalone deploy keeps Lax defaults.
      ...(env("GSD_EMBED_COOKIES") === "true"
        ? {
            defaultCookieAttributes: {
              sameSite: "none",
              secure: true,
              partitioned: true,
            },
          }
        : {}),
    },
  });
};
