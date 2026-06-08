import { z } from "zod";

/**
 * Structured-output contract shapes for the AI layer. Used now to validate the
 * health smoke test and reused by Phase 1 generation endpoints. Each has a
 * matching JSON Schema passed to the CLI's `--json-schema` for provider-side
 * validation; the Zod schema is the authoritative post-validation gate.
 */

// ── Health probe ─────────────────────────────────────────────────────────────

export const healthProbeSchema = z.object({ ok: z.literal(true) }).strict();

export const healthProbeJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: { ok: { type: "boolean", const: true } },
  required: ["ok"],
  additionalProperties: false,
};

// ── Cover letter ─────────────────────────────────────────────────────────────

export const coverLetterSchema = z
  .object({
    greeting: z.string(),
    body: z.array(z.string().min(1)).min(1),
    closing: z.string(),
  })
  .strict();

export type CoverLetter = z.infer<typeof coverLetterSchema>;

export const coverLetterJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    greeting: { type: "string" },
    body: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    closing: { type: "string" },
  },
  required: ["greeting", "body", "closing"],
  additionalProperties: false,
};

// ── Resume (tailored) ────────────────────────────────────────────────────────

export const resumeSchema = z
  .object({
    summary: z.string(),
    highlightedSkills: z.array(z.string()),
    experienceOrder: z.array(z.string()),
    tailoringNotes: z.array(z.string()).default([]),
  })
  .strict();

export type TailoredResume = z.infer<typeof resumeSchema>;

export const resumeJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: { type: "string" },
    highlightedSkills: { type: "array", items: { type: "string" } },
    experienceOrder: { type: "array", items: { type: "string" } },
    tailoringNotes: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "highlightedSkills", "experienceOrder"],
  additionalProperties: false,
};

// ── Screening answers ────────────────────────────────────────────────────────

export const screeningAnswerSchema = z
  .object({
    question: z.string().min(1),
    answer: z.string().min(1),
  })
  .strict();

export const screeningAnswersSchema = z
  .object({ answers: z.array(screeningAnswerSchema) })
  .strict();

export type ScreeningAnswers = z.infer<typeof screeningAnswersSchema>;

export const screeningAnswersJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string", minLength: 1 },
          answer: { type: "string", minLength: 1 },
        },
        required: ["question", "answer"],
        additionalProperties: false,
      },
    },
  },
  required: ["answers"],
  additionalProperties: false,
};
