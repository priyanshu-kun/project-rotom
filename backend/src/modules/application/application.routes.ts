import { Router, type Request } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { BadRequestError, NotFoundError, UnauthorizedError, ValidationError } from "../../lib/errors.js";
import { requireParam } from "../../lib/httpParams.js";
import { enqueueGeneration } from "../generation/queue.js";
import { ALL_GENERATION_TYPES } from "../generation/generation.service.js";
import * as repo from "./application.repo.js";
import {
  createApplicationSchema,
  generationType,
  listQuerySchema,
  updateApplicationSchema,
  updateStatusSchema,
} from "./application.schema.js";
import {
  createApplication,
  deleteApplication,
  getApplication,
  listApplications,
  updateApplication,
  updateStatus,
} from "./application.service.js";

export const applicationRouter: Router = Router();

function userIdOf(req: Request): string {
  if (!req.userId) {
    throw new UnauthorizedError("Missing authenticated user");
  }
  return req.userId;
}

// POST /api/applications — create from URL or pasted JD (sync extraction).
applicationRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createApplicationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid application payload", parsed.error.flatten());
    }
    const created = await createApplication(userIdOf(req), parsed.data);
    res.status(201).json(created);
  }),
);

// GET /api/applications — filtered list (TRK-2).
applicationRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError("Invalid query parameters", parsed.error.flatten());
    }
    const { items, total } = await listApplications(userIdOf(req), parsed.data);
    res.json({ applications: items, total, limit: parsed.data.limit, offset: parsed.data.offset });
  }),
);

// GET /api/applications/:id — detail (app + JD + artifacts + timeline).
applicationRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const detail = await getApplication(userIdOf(req), requireParam(req, "id"));
    res.json(detail);
  }),
);

// PATCH /api/applications/:id — update company/role/notes.
applicationRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateApplicationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid update payload", parsed.error.flatten());
    }
    const application = await updateApplication(userIdOf(req), requireParam(req, "id"), parsed.data);
    res.json({ application });
  }),
);

// PATCH /api/applications/:id/status — validated status transition (TRK-3, LC-2/LC-3).
applicationRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid status payload", parsed.error.flatten());
    }
    const result = await updateStatus(userIdOf(req), requireParam(req, "id"), parsed.data.toStatus, parsed.data.note);
    res.json(result);
  }),
);

// DELETE /api/applications/:id — hard delete (cascades; right-to-delete).
applicationRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await deleteApplication(userIdOf(req), requireParam(req, "id"));
    res.status(204).end();
  }),
);

// GET /api/applications/:id/artifacts — latest per type, or all versions (?all=true).
applicationRouter.get(
  "/:id/artifacts",
  asyncHandler(async (req, res) => {
    const userId = userIdOf(req);
    const application = await repo.findById(userId, requireParam(req, "id"));
    if (!application) {
      throw new NotFoundError("Application not found");
    }
    const all = req.query.all === "true";
    const artifacts = await repo.listArtifacts(requireParam(req, "id"), { all });
    res.json({ artifacts });
  }),
);

// POST /api/applications/:id/generate — enqueue combined generation (all types).
applicationRouter.post(
  "/:id/generate",
  asyncHandler(async (req, res) => {
    const userId = userIdOf(req);
    const application = await repo.findById(userId, requireParam(req, "id"));
    if (!application) {
      throw new NotFoundError("Application not found");
    }
    const instructions = parseInstructions(req);
    const jobId = await enqueueGeneration({
      userId,
      applicationId: requireParam(req, "id"),
      types: ALL_GENERATION_TYPES,
      ...(instructions !== undefined ? { instructions } : {}),
    });
    res.status(202).json({ jobId, status: "queued", types: ALL_GENERATION_TYPES });
  }),
);

// POST /api/applications/:id/generate/:type — enqueue a single-type regeneration.
applicationRouter.post(
  "/:id/generate/:type",
  asyncHandler(async (req, res) => {
    const userId = userIdOf(req);
    const typeResult = generationType.safeParse(requireParam(req, "type"));
    if (!typeResult.success) {
      throw new BadRequestError("type must be one of: resume, cover_letter, answers");
    }
    const application = await repo.findById(userId, requireParam(req, "id"));
    if (!application) {
      throw new NotFoundError("Application not found");
    }
    const instructions = parseInstructions(req);
    const jobId = await enqueueGeneration({
      userId,
      applicationId: requireParam(req, "id"),
      types: [typeResult.data],
      ...(instructions !== undefined ? { instructions } : {}),
    });
    res.status(202).json({ jobId, status: "queued", types: [typeResult.data] });
  }),
);

/** Optional `{ instructions }` body for regeneration (GEN-5-lite). */
function parseInstructions(req: Request): string | undefined {
  const body = req.body as { instructions?: unknown } | undefined;
  if (body?.instructions === undefined) {
    return undefined;
  }
  if (typeof body.instructions !== "string" || body.instructions.length > 2_000) {
    throw new BadRequestError("instructions must be a string up to 2000 characters");
  }
  return body.instructions;
}
