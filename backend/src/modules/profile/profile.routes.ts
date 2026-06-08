import { Router, type Request } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { UnauthorizedError, ValidationError } from "../../lib/errors.js";
import { profileInputSchema, profilePatchSchema } from "./profile.schema.js";
import {
  getProfileOrNull,
  getProfileVersions,
  patchProfile,
  replaceProfile,
} from "./profile.service.js";

export const profileRouter: Router = Router();

/** `req.userId` is guaranteed by requireAuth mounted ahead of this router. */
function userIdOf(req: Request): string {
  if (!req.userId) {
    throw new UnauthorizedError("Missing authenticated user");
  }
  return req.userId;
}

// GET /api/profile — current profile (PR-5). 200 with profile, or 200 with null
// when onboarding hasn't run (lets the client distinguish "empty" from error).
profileRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const profile = await getProfileOrNull(userIdOf(req));
    res.json({ profile });
  }),
);

// PUT /api/profile — full replace/upsert (PR-1…PR-4).
profileRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = profileInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid profile payload", parsed.error.flatten());
    }
    const profile = await replaceProfile(userIdOf(req), parsed.data);
    res.json({ profile });
  }),
);

// PATCH /api/profile — partial section update (PR-6).
profileRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = profilePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid profile patch payload", parsed.error.flatten());
    }
    const profile = await patchProfile(userIdOf(req), parsed.data);
    res.json({ profile });
  }),
);

// GET /api/profile/versions — version history (newest first).
profileRouter.get(
  "/versions",
  asyncHandler(async (req, res) => {
    const versions = await getProfileVersions(userIdOf(req));
    res.json({
      versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString() })),
    });
  }),
);
