import path from "node:path";

/** Runtime configuration, read once from the environment. */
export type ApiConfig = {
  port: number;
  host: string;
  databaseUrl: string;
  /** PEM content of the Aiven project CA. When set, the server certificate is fully verified. */
  databaseCaCert: string | undefined;
  /** Allowed browser origins; entries may contain `*` wildcards, e.g. `https://*.lovable.app`. */
  corsOrigins: string[];
  migrateOnStart: boolean;
  seedOnStart: boolean;
  fixturesDir: string;
  logLevel: string;
};

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:*",
  "http://127.0.0.1:*",
  "https://*.lovable.app",
  "https://*.lovableproject.com",
  "https://*.lovable.dev",
];

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required (Aiven PostgreSQL service URI).");
  const extraOrigins = list(env.CORS_ORIGINS);
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? "0.0.0.0",
    databaseUrl,
    databaseCaCert: env.DATABASE_CA_CERT?.replace(/\\n/gu, "\n") || undefined,
    corsOrigins: bool(env.CORS_DEFAULTS, true) ? [...DEFAULT_CORS_ORIGINS, ...extraOrigins] : extraOrigins,
    migrateOnStart: bool(env.MIGRATE_ON_START, true),
    seedOnStart: bool(env.SEED_ON_START, true),
    fixturesDir: path.resolve(env.FIXTURES_DIR ?? path.join(process.cwd(), "fixtures")),
    logLevel: env.LOG_LEVEL ?? "info",
  };
}
