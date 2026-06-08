import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration. The schema is the single SQL source of truth;
 * `npm run migrate:generate` diffs it into versioned SQL under ./drizzle.
 *
 * DATABASE_URL is read from the environment (loaded via dotenv in the npm
 * script context); drizzle-kit only needs it for introspection/push, not for
 * plain `generate`.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://rotom:rotom@localhost:5432/rotom",
  },
  strict: true,
  verbose: true,
});
