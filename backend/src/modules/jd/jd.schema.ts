import { z } from "zod";

/**
 * Structured job description (PRD JD-2). Mirrors the `job_descriptions` table
 * columns. Produced by the AI layer from raw posting text; every array defaults
 * to empty so a sparse posting still yields a valid record. `extractionConfidence`
 * is the model's self-reported 0–1 confidence, surfaced to the user (JD-5).
 */
export const structuredJdSchema = z
  .object({
    title: z.string().nullable().default(null),
    company: z.string().nullable().default(null),
    location: z.string().nullable().default(null),
    responsibilities: z.array(z.string()).default([]),
    requiredSkills: z.array(z.string()).default([]),
    preferredSkills: z.array(z.string()).default([]),
    qualifications: z.array(z.string()).default([]),
    keywords: z.array(z.string()).default([]),
    questions: z.array(z.string()).default([]),
    formFields: z.array(z.string()).default([]),
    extractionConfidence: z.number().min(0).max(1).default(0),
  })
  .strict();

export type StructuredJd = z.infer<typeof structuredJdSchema>;

/** JSON Schema handed to the CLI's `--json-schema` for provider-side validation. */
export const structuredJdJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    title: { type: ["string", "null"] },
    company: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    responsibilities: { type: "array", items: { type: "string" } },
    requiredSkills: { type: "array", items: { type: "string" } },
    preferredSkills: { type: "array", items: { type: "string" } },
    qualifications: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
    formFields: { type: "array", items: { type: "string" } },
    extractionConfidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "title",
    "company",
    "location",
    "responsibilities",
    "requiredSkills",
    "preferredSkills",
    "qualifications",
    "keywords",
    "questions",
    "formFields",
    "extractionConfidence",
  ],
  additionalProperties: false,
};
