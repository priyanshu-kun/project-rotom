import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env, isProduction } from "../config/env.js";
import { logger } from "../lib/logger.js";
import * as schema from "./schema.js";

const { Pool } = pg;

/**
 * Shared connection pool. Sized conservatively for a single-user service; the
 * generation workload is bursty and short-lived, so a small pool suffices.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (error) => {
  // Errors on idle clients would otherwise crash the process.
  logger.error({ err: error }, "Unexpected error on idle Postgres client");
});

export type Database = NodePgDatabase<typeof schema>;

export const db: Database = drizzle(pool, {
  schema,
  logger: !isProduction && env.LOG_LEVEL === "debug",
});

/** Liveness probe used by the health endpoint. */
export async function pingDatabase(): Promise<void> {
  await pool.query("SELECT 1");
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
