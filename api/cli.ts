/**
 * Database maintenance commands:
 *   npm run db:check    # SELECT 1 against DATABASE_URL
 *   npm run db:migrate  # apply pending migrations
 *   npm run db:seed     # migrate, then insert demo documents and invoice history (idempotent)
 */
import { loadConfig } from "./config.js";
import { checkDb, createDb } from "./db.js";
import { migrate } from "./migrations.js";
import { seed } from "./seed.js";

const command = process.argv[2];
const config = loadConfig();
const db = createDb(config.databaseUrl, config.databaseCaCert);

try {
  const health = await checkDb(db);
  console.log(`db: ${health.ok ? "ok" : "FAILED"} (${health.latencyMs} ms, PostgreSQL ${health.serverVersion ?? "?"}, tls=${health.tls ?? "?"})${health.error ? ` ${health.error}` : ""}`);
  if (!health.ok) process.exitCode = 1;
  else if (command === "migrate" || command === "seed") {
    const applied = await migrate(db, console.log);
    console.log(`migrations: ${applied.length ? applied.join(", ") : "up to date"}`);
    if (command === "seed") console.log("seed:", await seed(db, config.fixturesDir));
  } else if (command !== "check") {
    console.error("usage: cli.ts check|migrate|seed");
    process.exitCode = 1;
  }
} finally {
  await db.end();
}
