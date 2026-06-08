import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

/**
 * Shared Redis connection. Phase 0 uses Redis only for liveness; later phases
 * add caching of extracted JDs and a BullMQ generation queue.
 *
 * `lazyConnect` keeps construction side-effect-free so importing this module
 * (e.g. in tests) does not open a socket until `connectRedis()` is called.
 */
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 200, 2_000),
});

redis.on("error", (error) => {
  logger.error({ err: error }, "Redis connection error");
});

export async function connectRedis(): Promise<void> {
  if (redis.status === "ready" || redis.status === "connecting") {
    return;
  }
  await redis.connect();
}

/** Liveness probe used by the health endpoint. */
export async function pingRedis(): Promise<void> {
  const reply: string = await redis.ping();
  if (reply !== "PONG") {
    throw new Error(`Unexpected Redis PING reply: ${reply}`);
  }
}

export async function closeRedis(): Promise<void> {
  if (redis.status !== "end") {
    await redis.quit();
  }
}
