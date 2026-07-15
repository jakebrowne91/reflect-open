#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const WEB_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
process.chdir(WEB_ROOT);

const client = new PGlite({
  dataDir: "./pgdata",
  extensions: { pg_trgm, uuid_ossp },
});

try {
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "../../packages/db/migrations" });
  console.log("[gsd-db] local PGLite migrations are ready");
} finally {
  await client.close();
}
