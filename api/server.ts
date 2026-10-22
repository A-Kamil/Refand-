import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { checkDb, createDb } from "./db.js";
import { loadFixtures } from "./fixtures.js";
import { migrate } from "./migrations.js";
import { failInterruptedAnalyses } from "./repository.js";
import { seed } from "./seed.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.databaseUrl, config.databaseCaCert);
  const fixtures = await loadFixtures(config.fixturesDir);
  const app = await buildApp({ db, fixtures, corsOrigins: config.corsOrigins, logLevel: config.logLevel });

  const dbHealth = await checkDb(db);
  if (!dbHealth.ok) throw new Error(`PostgreSQL unreachable: ${dbHealth.error}`);
  app.log.info({ serverVersion: dbHealth.serverVersion, tls: dbHealth.tls }, "PostgreSQL connected (SELECT 1 ok)");

  if (config.migrateOnStart) await migrate(db, (m) => app.log.info(m));
  const interrupted = await failInterruptedAnalyses(db);
  if (interrupted) app.log.warn({ interrupted }, "marked interrupted analyses as FAILED");
  if (config.seedOnStart) app.log.info(await seed(db, config.fixturesDir), "seed done");
  if (!fixtures) app.log.warn({ dir: config.fixturesDir }, "demo fixtures not found; FIXTURE mode disabled");

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
