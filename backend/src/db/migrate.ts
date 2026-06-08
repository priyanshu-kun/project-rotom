import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, db } from "./client.js";
import { logger } from "../lib/logger.js";

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

/**
 * Applies pending SQL migrations from ./drizzle. Safe to run repeatedly —
 * drizzle tracks applied migrations in its own metadata table.
 */
export async function runMigrations(): Promise<void> {
  logger.info({ migrationsFolder }, "Applying database migrations");
  await migrate(db, { migrationsFolder });
  logger.info("Migrations applied");
}

// Allow `tsx src/db/migrate.ts` as a standalone CLI.
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => closeDatabase())
    .then(() => {
      process.exit(0);
    })
    .catch((error: unknown) => {
      logger.error({ err: error }, "Migration failed");
      process.exit(1);
    });
}
