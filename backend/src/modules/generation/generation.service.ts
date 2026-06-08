import type { ZodType } from "zod";
import { logger } from "../../lib/logger.js";
import { NotFoundError } from "../../lib/errors.js";
import type { ArtifactKind } from "../../db/schema.js";
import { findByUserId } from "../profile/profile.repo.js";
import * as appRepo from "../application/application.repo.js";
import type { GenerationType } from "../application/application.schema.js";
import { claudeCliProvider } from "./claudeCli.provider.js";
import type { GenerationProvider } from "./provider.js";
import {
  buildAnswersPrompt,
  buildCoverLetterPrompt,
  buildResumePrompt,
  buildSystemContract,
  type GenerationGrounding,
} from "./prompts.js";
import {
  coverLetterJsonSchema,
  coverLetterSchema,
  resumeJsonSchema,
  resumeSchema,
  screeningAnswersJsonSchema,
  screeningAnswersSchema,
} from "./generation.schema.js";
import type { StructuredJd } from "../jd/jd.schema.js";

/** Map the API-facing generation type to the persisted artifact_type enum. */
const ARTIFACT_KIND: Record<GenerationType, ArtifactKind> = {
  resume: "resume",
  cover_letter: "cover_letter",
  answers: "answer",
};

export const ALL_GENERATION_TYPES: GenerationType[] = ["resume", "cover_letter", "answers"];

export interface GenerationJobData {
  userId: string;
  applicationId: string;
  types: GenerationType[];
  instructions?: string;
}

export interface ArtifactResult {
  type: GenerationType;
  status: "fulfilled" | "rejected";
  artifactId?: string;
  version?: number;
  error?: string;
}

export interface GenerationJobResult {
  applicationId: string;
  results: ArtifactResult[];
  partial: boolean;
}

interface PromptPlan {
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  outputSchema: ZodType;
}

function planFor(
  type: GenerationType,
  grounding: GenerationGrounding,
  jd: StructuredJd,
  instructions: string | undefined,
): PromptPlan {
  switch (type) {
    case "resume":
      return {
        userPrompt: buildResumePrompt(grounding, jd, instructions),
        jsonSchema: resumeJsonSchema,
        outputSchema: resumeSchema,
      };
    case "cover_letter":
      return {
        userPrompt: buildCoverLetterPrompt(grounding, jd, instructions),
        jsonSchema: coverLetterJsonSchema,
        outputSchema: coverLetterSchema,
      };
    case "answers":
      return {
        userPrompt: buildAnswersPrompt(grounding, jd, jd.questions, instructions),
        jsonSchema: screeningAnswersJsonSchema,
        outputSchema: screeningAnswersSchema,
      };
  }
}

/**
 * Generate one artifact and persist it as a new immutable version, pointing the
 * application at it (resume / cover letter). The provider is injected for tests.
 */
export async function generateArtifact(
  data: { userId: string; applicationId: string; type: GenerationType; instructions?: string },
  provider: GenerationProvider = claudeCliProvider,
): Promise<{ type: GenerationType; artifactId: string; version: number }> {
  const stored = await findByUserId(data.userId);
  if (!stored) {
    throw new NotFoundError("Cannot generate before a profile exists");
  }
  const jd = await appRepo.getStructuredJd(data.applicationId);
  if (!jd) {
    throw new NotFoundError("Application or job description not found");
  }

  const grounding: GenerationGrounding = {
    personal: stored.personal,
    professional: stored.professional,
    preferences: stored.preferences,
  };
  const plan = planFor(data.type, grounding, jd, data.instructions);

  const result = await provider.generate({
    systemContract: buildSystemContract({ jsonOnly: true }),
    userPrompt: plan.userPrompt,
    jsonSchema: plan.jsonSchema,
    outputSchema: plan.outputSchema,
  });

  const content: unknown =
    result.structured ?? plan.outputSchema.parse(JSON.parse(result.text) as unknown);
  const kind = ARTIFACT_KIND[data.type];
  const nextVersion = (await appRepo.latestArtifactVersion(data.applicationId, kind)) + 1;
  const artifact = await appRepo.insertArtifactVersion({
    applicationId: data.applicationId,
    type: kind,
    content,
    version: nextVersion,
    editedByUser: false,
  });
  await appRepo.setApplicationPointer(data.applicationId, kind, artifact.id);

  return { type: data.type, artifactId: artifact.id, version: artifact.version };
}

/**
 * Process a generation job: generate each requested type, tolerating
 * per-artifact failure (PRD NFR 9.2 — partial success rather than whole-batch
 * failure). This is the unit the BullMQ worker wraps and unit tests call
 * directly (no real queue required).
 */
export async function processGenerationJob(
  data: GenerationJobData,
  provider: GenerationProvider = claudeCliProvider,
): Promise<GenerationJobResult> {
  const settled = await Promise.allSettled(
    data.types.map((type) =>
      generateArtifact(
        { userId: data.userId, applicationId: data.applicationId, type, ...(data.instructions !== undefined ? { instructions: data.instructions } : {}) },
        provider,
      ),
    ),
  );

  const results: ArtifactResult[] = settled.map((outcome, index) => {
    const type = data.types[index]!;
    if (outcome.status === "fulfilled") {
      return {
        type,
        status: "fulfilled",
        artifactId: outcome.value.artifactId,
        version: outcome.value.version,
      };
    }
    const error = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    logger.error({ applicationId: data.applicationId, type, err: outcome.reason }, "Artifact generation failed");
    return { type, status: "rejected", error };
  });

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  return {
    applicationId: data.applicationId,
    results,
    partial: fulfilled > 0 && fulfilled < results.length,
  };
}
