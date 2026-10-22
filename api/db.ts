import pg from "pg";

// Return DATE columns as "YYYY-MM-DD" strings and BIGINT/NUMERIC as numbers (amounts are cents, well below 2^53).
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(20, (v: string) => Number(v));
pg.types.setTypeParser(1700, (v: string) => Number(v));

export type Db = pg.Pool;
export type DbClient = pg.PoolClient | pg.Pool;

const SSL_URL_PARAMS = ["sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"];

/**
 * Builds the pool options for an Aiven service URI (`...?sslmode=require`).
 * - With the project CA (DATABASE_CA_CERT): TLS with full certificate verification.
 * - Without it: node-postgres would treat `sslmode=require` as verify-full and reject Aiven's
 *   self-signed CA, so libpq semantics are requested (encrypted, certificate not verified).
 */
export function poolConfig(databaseUrl: string, caCert?: string): pg.PoolConfig {
  const url = new URL(databaseUrl);
  const base: pg.PoolConfig = { max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 };
  if (caCert) {
    for (const p of SSL_URL_PARAMS) url.searchParams.delete(p);
    return { ...base, connectionString: url.toString(), ssl: { ca: caCert, rejectUnauthorized: true } };
  }
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode && sslmode !== "disable" && !url.searchParams.has("uselibpqcompat")) {
    url.searchParams.set("uselibpqcompat", "true");
  }
  return { ...base, connectionString: url.toString() };
}

export function createDb(databaseUrl: string, caCert?: string): Db {
  return new pg.Pool(poolConfig(databaseUrl, caCert));
}

export async function withTransaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type DbHealth = { ok: boolean; latencyMs: number; serverVersion?: string; tls?: boolean; error?: string };

export async function checkDb(db: Db): Promise<DbHealth> {
  const started = Date.now();
  try {
    const { rows } = await db.query<{ one: number; version: string; tls: boolean | null }>(
      "SELECT 1 AS one, current_setting('server_version') AS version, (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls",
    );
    const row = rows[0];
    return { ok: row?.one === 1, latencyMs: Date.now() - started, serverVersion: row?.version, tls: row?.tls ?? false };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}
