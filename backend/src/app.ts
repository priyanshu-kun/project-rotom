import express, { type Express } from "express";
import helmet from "helmet";
import { requestId } from "./middleware/requestId.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { healthRouter } from "./health/routes.js";
import { profileRouter } from "./modules/profile/profile.routes.js";
import { generationRouter } from "./modules/generation/generation.routes.js";
import { applicationRouter } from "./modules/application/application.routes.js";
import { artifactRouter } from "./modules/artifact/artifact.routes.js";

/**
 * Assembles the Express application. Kept free of side effects (no `listen`, no
 * DB/Redis connection) so it can be imported directly by integration tests.
 */
export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy in production; trust the first hop for correct IPs.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestId);

  // Unauthenticated health probe.
  app.use(healthRouter);

  // All API routes require the single-user API token.
  app.use("/api", requireAuth);
  app.use("/api/profile", profileRouter);
  app.use("/api/applications", applicationRouter);
  app.use("/api/artifacts", artifactRouter);
  app.use("/api/generation", generationRouter);

  // Fallbacks — order matters: 404 then the central error handler.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
