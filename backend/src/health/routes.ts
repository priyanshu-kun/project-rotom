import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { pingDatabase } from "../db/client.js";
import { pingRedis } from "../redis/client.js";

export const healthRouter: Router = Router();

/**
 * Liveness + dependency readiness probe. Unauthenticated by design so
 * orchestrators can poll it. Returns 200 only when both Postgres and Redis
 * respond; 503 otherwise with per-dependency detail.
 */
healthRouter.get(
  "/healthz",
  asyncHandler(async (_req, res) => {
    const [database, redis] = await Promise.allSettled([pingDatabase(), pingRedis()]);

    const checks = {
      database: database.status === "fulfilled" ? "ok" : "down",
      redis: redis.status === "fulfilled" ? "ok" : "down",
    } as const;

    const healthy = checks.database === "ok" && checks.redis === "ok";
    res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks });
  }),
);
