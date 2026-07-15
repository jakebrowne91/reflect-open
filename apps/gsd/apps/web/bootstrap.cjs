/**
 * Bootstrap script for the distroless production image.
 *
 * Distroless images have no shell, so this Node.js script handles two tasks
 * that would normally be done in an entrypoint.sh:
 *
 * 1. Regenerate `public/__ENV.js` with the current runtime NEXT_PUBLIC_*
 *    environment variables.  The file was originally created at build time by
 *    next-runtime-env's `configureRuntimeEnv()`, but in a Docker deployment the
 *    env vars are provided at *run* time via docker-compose / docker run.
 *
 * 2. Start the Next.js standalone server.
 */

const { createHash } = require("crypto");
const { writeFileSync, existsSync, mkdirSync, readFileSync } = require("fs");
const path = require("path");

/**
 * @typedef {{ idx: number; when: number; tag: string; breakpoints: boolean }} MigrationJournalEntry
 * @typedef {{ entries: MigrationJournalEntry[] }} MigrationJournal
 */

// ---------------------------------------------------------------------------
// 1. Inject runtime NEXT_PUBLIC_* env vars into __ENV.js
// ---------------------------------------------------------------------------

const publicDir = path.join(__dirname, "apps", "web", "public");

if (!existsSync(publicDir)) {
  mkdirSync(publicDir, { recursive: true });
}

/** @type {Record<string, string | undefined>} */
const envVars = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("NEXT_PUBLIC_")) {
    envVars[key] = value;
  }
}

writeFileSync(
  path.join(publicDir, "__ENV.js"),
  `self.__ENV = ${JSON.stringify(envVars)};`,
);

// ---------------------------------------------------------------------------
// 2. Run database migrations
// ---------------------------------------------------------------------------

async function runDatabaseMigrations() {
  if (process.env.KAN_SKIP_MIGRATIONS === "true") {
    console.log(
      "Skipping database migrations because KAN_SKIP_MIGRATIONS=true",
    );
    return;
  }

  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    console.log("Skipping database migrations because POSTGRES_URL is not set");
    return;
  }

  const migrationsFolder = path.join(__dirname, "packages", "db", "migrations");
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");

  if (!existsSync(journalPath)) {
    throw new Error(`Database migration journal not found at ${journalPath}`);
  }

  /** @type {MigrationJournal} */
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const migrations = journal.entries.map((entry) => {
    const migrationPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    const sql = readFileSync(migrationPath, "utf8");

    return {
      tag: entry.tag,
      when: entry.when,
      hash: createHash("sha256").update(sql).digest("hex"),
      statements: sql
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean),
    };
  });

  const pool = new (getPgPool())(getPoolConfig(connectionString));
  const client = await pool.connect();
  let migrationLockAcquired = false;

  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('kan_database_migrations'))",
    );
    migrationLockAcquired = true;

    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    const appliedResult = await client.query(
      'SELECT created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
    );
    const lastAppliedAt = Number(appliedResult.rows[0]?.created_at ?? 0);
    const pending = migrations.filter(
      (migration) => Number(migration.when) > lastAppliedAt,
    );

    if (pending.length === 0) {
      console.log("Database migrations already up to date");
      return;
    }

    console.log(`Applying ${pending.length} database migration(s)`);

    for (const migration of pending) {
      await client.query("BEGIN");
      try {
        for (const statement of migration.statements) {
          await client.query(statement);
        }

        await client.query(
          'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
          [migration.hash, migration.when],
        );
        await client.query("COMMIT");
        console.log(`Applied database migration ${migration.tag}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    if (migrationLockAcquired) {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('kan_database_migrations'))",
      );
    }
    client.release();
    await pool.end();
  }
}

/** @returns {typeof import("pg").Pool} */
function getPgPool() {
  try {
    return require("pg").Pool;
  } catch {
    return require(path.join(__dirname, "migration-node_modules", "pg")).Pool;
  }
}

/** @param {string} connectionString */
function getPoolConfig(connectionString) {
  const connectionUrl = new URL(connectionString);
  const urlSslMode = connectionUrl.searchParams.get("sslmode")?.toLowerCase();
  connectionUrl.searchParams.delete("sslmode");

  const isLocal =
    connectionUrl.hostname === "localhost" ||
    connectionUrl.hostname === "127.0.0.1" ||
    connectionUrl.hostname.endsWith(".railway.internal");
  const shouldUseSsl =
    process.env.POSTGRES_SSL?.toLowerCase() === "true" ||
    process.env.PGSSLMODE?.toLowerCase() === "require" ||
    urlSslMode === "require" ||
    (process.env.NODE_ENV === "production" && !isLocal);
  const rejectUnauthorized =
    process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED?.toLowerCase() === "true";

  return {
    connectionString: connectionUrl.toString(),
    ...(shouldUseSsl ? { ssl: { rejectUnauthorized } } : {}),
  };
}

// ---------------------------------------------------------------------------
// 3. Start the Next.js standalone server
// ---------------------------------------------------------------------------

runDatabaseMigrations()
  .then(() => {
    // Generated by `next build` when standalone output is enabled.
    // @ts-expect-error This file exists only inside the production image.
    require("./apps/web/server.js");
  })
  .catch((error) => {
    console.error("Database migration failed", error);
    process.exit(1);
  });
