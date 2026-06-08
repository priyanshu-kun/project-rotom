import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, pool } from "./client.js";
import { logger } from "../lib/logger.js";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

/**
 * Applies pending plain-SQL migrations from ./migrations in filename order. Each
 * unapplied file runs as one transaction (node-pg's simple-query protocol
 * executes the whole multi-statement file), and its name is recorded in the
 * `_migrations` table so the runner is idempotent and safe to call repeatedly.
 */
export async function runMigrations(): Promise<void> {
  logger.info({ migrationsFolder }, "Applying database migrations");

  await pool.query(
    `CREATE TABLE IF NOT EXISTS "_migrations" (
       "id" text PRIMARY KEY,
       "applied_at" timestamp with time zone NOT NULL DEFAULT now()
     )`,
  );

  const files = readdirSync(migrationsFolder)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    const already = await pool.query('SELECT 1 FROM "_migrations" WHERE "id" = $1', [file]);
    if (already.rowCount && already.rowCount > 0) {
      continue;
    }

    const sql = readFileSync(path.join(migrationsFolder, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query('INSERT INTO "_migrations" ("id") VALUES ($1)', [file]);
      await client.query("COMMIT");
      appliedCount += 1;
      logger.info({ file }, "Applied migration");
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error({ err: error, file }, "Migration failed; rolled back");
      throw error;
    } finally {
      client.release();
    }
  }

  logger.info({ appliedCount, total: files.length }, "Migrations up to date");
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
