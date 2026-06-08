import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // Provide the env the config module validates at import time. Real values
    // (DB/Redis/Anthropic) come from the shell for integration tests.
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      // Fixed 32-byte base64 key for deterministic crypto tests.
      DATA_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
      ANTHROPIC_API_KEY: "test-anthropic-key",
      // Isolated test database (created by db-init/01-create-test-db.sql) so
      // the suite never wipes or pollutes the dev `rotom` database.
      DATABASE_URL: "postgresql://rotom:rotom@localhost:5433/rotom_test",
      REDIS_URL: "redis://localhost:6380",
    },
    // Integration tests touch a real Postgres; keep them serial to avoid
    // cross-test interference on the single-user schema.
    fileParallelism: false,
    globals: false,
    clearMocks: true,
    testTimeout: 20_000,
  },
});
