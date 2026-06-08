import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

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

/** A client handle exposing only `query` — what repos need inside a transaction. */
export type QueryClient = Pick<pg.PoolClient, "query">;

/**
 * Run a parameterized query against the pool and return its rows. The generic
 * names the row shape; callers keep it in sync with the SELECT/RETURNING column
 * list (columns are aliased to camelCase so row keys match the TS field names).
 */
export async function query<Row extends pg.QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: readonly unknown[],
): Promise<Row[]> {
  const result = await pool.query<Row>(text, params ? [...params] : undefined);
  return result.rows;
}

/**
 * Execute `fn` inside a single transaction on one dedicated client. Commits on
 * success, rolls back on any thrown error, and always releases the client.
 */
export async function withTransaction<T>(fn: (client: QueryClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Liveness probe used by the health endpoint. */
export async function pingDatabase(): Promise<void> {
  await pool.query("SELECT 1");
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
