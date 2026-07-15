import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import createJiti from "jiti";
import { env } from "next-runtime-env";
import { configureRuntimeEnv } from "next-runtime-env/build/configure.js";

const shouldInitOpenNextCloudflareDev =
  process.env.RETROGRADE_SKIP_OPENNEXT_DEV !== "true" &&
  (process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ||
    process.env.CLOUDFLARE_ENV ||
    process.env.WRANGLER);

if (shouldInitOpenNextCloudflareDev) {
  initOpenNextCloudflareForDev();
}

// Import env files to validate at build time. Use jiti so we can load .ts files in here.
createJiti(fileURLToPath(import.meta.url))("./src/env");
const gsdWorkspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

/** @param {string} jsonc */
function stripJsonComments(jsonc) {
  let output = "";
  let inString = false;
  let stringQuote = "";
  let isEscaped = false;

  for (let index = 0; index < jsonc.length; index += 1) {
    const char = jsonc[index];
    const nextChar = jsonc[index + 1];

    if (inString) {
      output += char;
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      output += char;
      continue;
    }

    if (char === "/" && nextChar === "/") {
      while (index < jsonc.length && jsonc[index] !== "\n") {
        index += 1;
      }
      output += "\n";
      continue;
    }

    if (char === "/" && nextChar === "*") {
      index += 2;
      while (
        index < jsonc.length &&
        !(jsonc[index] === "*" && jsonc[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function loadCloudflarePublicEnv() {
  const wranglerConfigPath = new URL("./wrangler.jsonc", import.meta.url);
  if (!existsSync(wranglerConfigPath)) return;

  const json = stripJsonComments(
    readFileSync(wranglerConfigPath, "utf8"),
  ).replace(/,\s*([}\]])/g, "$1");
  const vars = JSON.parse(json).vars ?? {};

  for (const [key, value] of Object.entries(vars)) {
    if (!key.startsWith("NEXT_PUBLIC_")) continue;
    if (typeof value !== "string") continue;
    if (process.env[key]) continue;
    process.env[key] = value;
  }
}

loadCloudflarePublicEnv();
configureRuntimeEnv();

/** @type {import("next").NextConfig} */
const config = {
  output:
    env("NEXT_PUBLIC_USE_STANDALONE_OUTPUT") === "true"
      ? "standalone"
      : undefined,
  reactStrictMode: true,

  /** Exclude build tools and dev-only packages from the standalone output */
  outputFileTracingExcludes: {
    "**/*": [
      "@esbuild/**",
      "esbuild/**",
      "typescript/**",
      "webpack/**",
      "uglify-js/**",
      "terser/**",
    ],
  },

  outputFileTracingRoot: gsdWorkspaceRoot,

  /** Enables hot reloading for local packages without a build step */
  transpilePackages: [
    "@kan/api",
    "@kan/db",
    "@kan/shared",
    "@kan/auth",
    "@kan/stripe",
  ],

  /** We already do linting and typechecking as separate tasks in CI */
  typescript: { ignoreBuildErrors: true },

  // temporarily ignore eslint errors during build until we fix all the errors sigh
  eslint: { ignoreDuringBuilds: true },

  images: {
    remotePatterns: (() => {
      /** @type {Array<{protocol: "http" | "https", hostname: string}>} */
      const patterns = [
        { protocol: "https", hostname: "**" },
        {
          protocol: "http",
          hostname: "localhost",
        },
      ];

      return patterns;
    })(),
  },
  turbopack: {
    root: gsdWorkspaceRoot,
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/i,
      issuer: /\.[jt]sx?$/,
      use: ["@svgr/webpack"],
    });

    return config;
  },
  serverExternalPackages: ["@react-email/render", "pino", "stripe", "uncrypto"],

  experimental: {
    // instrumentationHook: true,
    swcPlugins: [["@lingui/swc-plugin", {}]],
  },

  async rewrites() {
    return [
      {
        source: "/settings",
        destination: "/settings/account",
      },
    ];
  },
};

// Only allow external images when OIDC is configured (for OIDC provider avatars)
if (
  env("OIDC_CLIENT_ID") &&
  env("OIDC_CLIENT_SECRET") &&
  env("OIDC_DISCOVERY_URL")
) {
  config.images?.remotePatterns?.push({
    protocol: "https",
    hostname: "**",
  });
}

export default config;
