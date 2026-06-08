import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { UnauthorizedError, ValidationError } from "../../lib/errors.js";
import { requireParam } from "../../lib/httpParams.js";
import { editArtifact } from "./artifact.service.js";

export const artifactRouter: Router = Router();

const editArtifactSchema = z.object({ content: z.unknown() }).strict();

function userIdOf(req: Request): string {
  if (!req.userId) {
    throw new UnauthorizedError("Missing authenticated user");
  }
  return req.userId;
}

// PATCH /api/artifacts/:id — immutability-preserving edit: creates a new version
// and repoints the application. Content is validated against the artifact's type.
artifactRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = editArtifactSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Body must be { content }", parsed.error.flatten());
    }
    const artifact = await editArtifact(userIdOf(req), requireParam(req, "id"), parsed.data.content);
    res.json({ artifact });
  }),
);
