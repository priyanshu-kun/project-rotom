import type { ZodType } from "zod";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import type { ArtifactKind, ArtifactRow } from "../../db/schema.js";
import * as appRepo from "../application/application.repo.js";
import {
  coverLetterSchema,
  resumeSchema,
  screeningAnswersSchema,
} from "../generation/generation.schema.js";

/** Validation schema per persisted artifact kind. */
const CONTENT_SCHEMA: Record<ArtifactKind, ZodType> = {
  resume: resumeSchema,
  cover_letter: coverLetterSchema,
  answer: screeningAnswersSchema,
};

/**
 * Apply a user edit to an artifact. Artifacts are immutable once created, so an
 * edit creates a NEW version (marked `editedByUser`) and repoints the
 * application at it — preserving the version that any prior submission
 * referenced. (Supports inline review/edit before submission; GEN-5 / FORM-3.)
 */
export async function editArtifact(
  userId: string,
  artifactId: string,
  content: unknown,
): Promise<ArtifactRow> {
  const found = await appRepo.findArtifactForUser(userId, artifactId);
  if (!found) {
    throw new NotFoundError("Artifact not found");
  }
  const { artifact } = found;

  const schema = CONTENT_SCHEMA[artifact.type];
  const parsed = schema.safeParse(content);
  if (!parsed.success) {
    throw new ValidationError(
      `Invalid content for a ${artifact.type} artifact`,
      parsed.error.flatten(),
    );
  }

  const nextVersion = (await appRepo.latestArtifactVersion(artifact.applicationId, artifact.type)) + 1;
  const created = await appRepo.insertArtifactVersion({
    applicationId: artifact.applicationId,
    type: artifact.type,
    content: parsed.data,
    version: nextVersion,
    editedByUser: true,
  });
  await appRepo.setApplicationPointer(artifact.applicationId, artifact.type, created.id);
  return created;
}
