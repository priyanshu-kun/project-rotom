import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { NotFoundError } from "../../lib/errors.js";
import { requireParam } from "../../lib/httpParams.js";
import { claudeCliProvider } from "./claudeCli.provider.js";
import { getGenerationJob } from "./queue.js";

export const generationRouter: Router = Router();

/**
 * GET /api/generation/health — acceptance probe for the AI layer.
 *
 * Runs a trivial, tool-less generation to verify the claude binary is present,
 * ANTHROPIC_API_KEY authenticates, the JSON envelope parses, and structured
 * output validates.
 */
generationRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const probe = await claudeCliProvider.healthCheck();
    res.json({ ok: true, ...probe });
  }),
);

/**
 * GET /api/generation/jobs/:jobId — poll a queued generation job.
 *
 * Returns the BullMQ job state and, when finished, its per-artifact result.
 * Artifacts persist in Postgres regardless of job TTL — `GET /api/applications/:id`
 * is the durable source of truth; this endpoint reports progress.
 */
generationRouter.get(
  "/jobs/:jobId",
  asyncHandler(async (req, res) => {
    const status = await getGenerationJob(requireParam(req, "jobId"));
    if (!status) {
      throw new NotFoundError("Generation job not found (it may have expired)");
    }
    res.json(status);
  }),
);
