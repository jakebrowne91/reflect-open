import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // The retrograde-support API tests each boot an in-memory PGlite database
    // and run migrations, so give them headroom beyond the 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: [
      { find: /^~\//, replacement: `${resolve(__dirname, "src")}/` },
      {
        // The package's "import" condition points at dist/, which is only
        // produced by its build step. Tests resolve straight to source.
        find: "@retrograde/support-contracts",
        replacement: resolve(
          __dirname,
          "../../packages/support-contracts/src/index.ts",
        ),
      },
    ],
  },
});
