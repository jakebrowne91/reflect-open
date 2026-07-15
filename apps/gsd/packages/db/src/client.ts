import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePgLite } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";

import { createLogger } from "@kan/logger";

import * as schema from "./schema";

const log = createLogger("db");
const DEFAULT_POSTGRES_POOL_MAX = 5;
const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for("__cloudflare-context__");

export type dbClient = NodePgDatabase<typeof schema> & {
  $client: Pool;
};

interface HyperdriveBinding {
  connectionString?: string;
}

interface CloudflareContextWithHyperdrive {
  env?: {
    HYPERDRIVE?: HyperdriveBinding;
  };
}

interface PostgresConnection {
  connectionString: string;
  viaHyperdrive: boolean;
}

let pgPool: Pool | null = null;
let pgDb: dbClient | null = null;
let pgConnectionString: string | null = null;
let pgliteDb: dbClient | null = null;
const requestScopedPools = new WeakSet<Pool>();

const getConnectionUrl = (connectionString: string): URL | null => {
  try {
    return new URL(connectionString);
  } catch {
    return null;
  }
};

const removeSslMode = (connectionString: string): string => {
  const url = getConnectionUrl(connectionString);

  if (!url) {
    return connectionString;
  }

  url.searchParams.delete("sslmode");

  return url.toString();
};

const isLocalConnection = (connectionString: string): boolean => {
  const url = getConnectionUrl(connectionString);
  const host = url?.hostname ?? connectionString;

  return ["localhost", "127.0.0.1", "::1"].includes(host);
};

const getPoolMax = (): number => {
  const configured = Number(process.env.POSTGRES_POOL_MAX);

  if (Number.isInteger(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_POSTGRES_POOL_MAX;
};

const shouldUseSsl = (connectionString: string): boolean => {
  const urlSslMode = getConnectionUrl(connectionString)
    ?.searchParams.get("sslmode")
    ?.toLowerCase();
  const envSslMode = process.env.PGSSLMODE?.toLowerCase();
  const explicitSsl = process.env.POSTGRES_SSL?.toLowerCase();
  const sslMode = envSslMode ?? urlSslMode;

  if (explicitSsl === "false" || sslMode === "disable") {
    return false;
  }

  if (
    explicitSsl === "true" ||
    sslMode === "require" ||
    sslMode === "verify-ca" ||
    sslMode === "verify-full"
  ) {
    return true;
  }

  return (
    process.env.NODE_ENV === "production" &&
    !isLocalConnection(connectionString)
  );
};

const shouldRejectUnauthorizedSsl = (): boolean =>
  process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED?.toLowerCase() === "true";

const getHyperdriveConnectionString = (): string | undefined => {
  const context = (
    globalThis as Record<symbol, CloudflareContextWithHyperdrive | undefined>
  )[CLOUDFLARE_CONTEXT_SYMBOL];
  const connectionString = context?.env?.HYPERDRIVE?.connectionString;

  return connectionString && connectionString.length > 0
    ? connectionString
    : undefined;
};

const getPostgresConnection = (
  connectionStringOverride?: string,
): PostgresConnection | undefined => {
  if (connectionStringOverride) {
    return { connectionString: connectionStringOverride, viaHyperdrive: false };
  }

  const hyperdriveConnectionString = getHyperdriveConnectionString();
  if (hyperdriveConnectionString) {
    return {
      connectionString: hyperdriveConnectionString,
      viaHyperdrive: true,
    };
  }

  return process.env.POSTGRES_URL
    ? { connectionString: process.env.POSTGRES_URL, viaHyperdrive: false }
    : undefined;
};

export const createDrizzleClient = (
  connectionStringOverride?: string,
): dbClient => {
  const connection = getPostgresConnection(connectionStringOverride);

  if (!connection) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("POSTGRES_URL or HYPERDRIVE is required in production");
    }

    if (pgliteDb) {
      return pgliteDb;
    }

    log.warn("POSTGRES_URL not set, falling back to PGLite");

    const client = new PGlite({
      dataDir: "./pgdata",
      extensions: { pg_trgm, uuid_ossp },
    });
    const db = drizzlePgLite(client, { schema });

    migrate(db, { migrationsFolder: "../../packages/db/migrations" });

    pgliteDb = db as unknown as dbClient;

    return pgliteDb;
  }

  const connectionString = connection.connectionString;

  if (connection.viaHyperdrive) {
    const pool = new Pool({
      connectionString,
      max: 1,
      maxUses: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 1_000,
      allowExitOnIdle: true,
    });
    requestScopedPools.add(pool);
    return drizzlePg(pool, { schema }) as dbClient;
  }

  if (pgDb && pgPool && pgConnectionString === connectionString) {
    return pgDb;
  }

  const ssl = !connection.viaHyperdrive && shouldUseSsl(connectionString);

  pgPool = new Pool({
    connectionString: ssl ? removeSslMode(connectionString) : connectionString,
    max: getPoolMax(),
    ...(ssl
      ? { ssl: { rejectUnauthorized: shouldRejectUnauthorizedSsl() } }
      : {}),
  });
  pgDb = drizzlePg(pgPool, { schema }) as dbClient;
  pgConnectionString = connectionString;

  return pgDb;
};

export const closeDrizzleClient = async (db: dbClient): Promise<void> => {
  if (!requestScopedPools.has(db.$client)) return;

  await db.$client.end().catch((error: unknown) => {
    log.warn({ err: error }, "Failed to close request-scoped Postgres pool");
  });
};
