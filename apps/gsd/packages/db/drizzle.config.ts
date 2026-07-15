import { type Config } from "drizzle-kit";

const connectionString = process.env.POSTGRES_URL ?? "";

const getConnectionUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const removeSslMode = (value: string): string => {
  const url = getConnectionUrl(value);

  if (!url) {
    return value;
  }

  url.searchParams.delete("sslmode");

  return url.toString();
};

const getSslMode = () => {
  const urlSslMode = getConnectionUrl(connectionString)
    ?.searchParams.get("sslmode")
    ?.toLowerCase();
  return process.env.PGSSLMODE?.toLowerCase() ?? urlSslMode;
};

const shouldUseSsl = () => {
  const explicitSsl = process.env.POSTGRES_SSL?.toLowerCase();
  const sslMode = getSslMode();

  if (explicitSsl === "false" || sslMode === "disable") {
    return false;
  }

  return (
    explicitSsl === "true" ||
    sslMode === "require" ||
    sslMode === "verify-ca" ||
    sslMode === "verify-full" ||
    process.env.NODE_ENV === "production"
  );
};

const getSslConfig = () => {
  if (!shouldUseSsl()) {
    return false;
  }

  return {
    rejectUnauthorized:
      process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED?.toLowerCase() === "true",
  };
};

export default {
  schema: "./src/schema",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: shouldUseSsl() ? removeSslMode(connectionString) : connectionString,
    ssl: getSslConfig(),
  },
  migrations: {
    prefix: "timestamp",
  },
} satisfies Config;
