import type { Server } from "node:http";
import type { Worker } from "bullmq";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { closeDatabase, pingDatabase } from "./db/client.js";
import { closeRedis, connectRedis } from "./redis/client.js";
import { bootstrapAuth } from "./modules/auth/auth.service.js";
import { startGenerationWorker } from "./modules/generation/worker.js";
import { closeQueue } from "./modules/generation/queue.js";

/**
 * Process bootstrap. Order: verify Postgres reachable → connect Redis →
 * ensure the single user + API token → start HTTP. Registers graceful
 * shutdown so in-flight requests drain and pools close cleanly.
 */
async function main(): Promise<void> {
  await pingDatabase();
  logger.info("Postgres connection OK");

  await connectRedis();
  logger.info("Redis connection OK");

  await bootstrapAuth();

  const worker = startGenerationWorker();
  logger.info({ concurrency: env.GENERATION_CONCURRENCY }, "Generation worker started");

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "Rotom backend listening");
  });

  registerShutdown(server, worker);
}

function registerShutdown(server: Server, worker: Worker): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");

    // Stop accepting new connections, then close dependencies.
    server.close((err) => {
      void (async () => {
        if (err) {
          logger.error({ err }, "Error closing HTTP server");
        }
        try {
          // Stop the worker first so in-flight jobs finish, then close pools.
          await worker.close();
          await Promise.allSettled([closeQueue(), closeDatabase(), closeRedis()]);
        } finally {
          process.exit(err ? 1 : 0);
        }
      })();
    });

    // Hard ceiling so a hung connection can't block shutdown forever.
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Fatal startup error");
  process.exit(1);
});
