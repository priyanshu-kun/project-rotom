import { z } from "zod";

/**
 * Profile schemas (PRD §11 / PR-1…PR-5). These define the canonical data
 * contract for the single source of truth. Validation happens at the route
 * boundary; inferred types flow through the service and repo layers.
 *
 * Optional free-text fields accept empty input by being `.optional()`; required
 * identity fields (name, email) are enforced.
 */

const nonEmpty = (label: string) => z.string().trim().min(1, `${label} is required`);
const optionalUrl = z.string().trim().url().optional().or(z.literal("").transform(() => undefined));

// ── Personal (encrypted at rest) ─────────────────────────────────────────────

export const personalSchema = z
  .object({
    fullName: nonEmpty("Full name").max(200),
    email: z.string().trim().email("A valid email is required").max(320),
    phone: z.string().trim().max(40).optional(),
    location: z.string().trim().max(200).optional(),
    website: optionalUrl,
  })
  .strict();

// ── Professional ─────────────────────────────────────────────────────────────

export const workExperienceSchema = z
  .object({
    company: nonEmpty("Company").max(200),
    title: nonEmpty("Title").max(200),
    location: z.string().trim().max(200).optional(),
    startDate: z.string().trim().max(40).optional(),
    endDate: z.string().trim().max(40).optional(),
    current: z.boolean().optional(),
    description: z.string().trim().max(5_000).optional(),
    highlights: z.array(z.string().trim().min(1).max(1_000)).max(50).optional(),
  })
  .strict();

export const educationSchema = z
  .object({
    institution: nonEmpty("Institution").max(200),
    degree: z.string().trim().max(200).optional(),
    fieldOfStudy: z.string().trim().max(200).optional(),
    startDate: z.string().trim().max(40).optional(),
    endDate: z.string().trim().max(40).optional(),
    gpa: z.string().trim().max(20).optional(),
  })
  .strict();

export const projectSchema = z
  .object({
    name: nonEmpty("Project name").max(200),
    description: z.string().trim().max(5_000).optional(),
    url: optionalUrl,
    technologies: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  })
  .strict();

export const certificationSchema = z
  .object({
    name: nonEmpty("Certification name").max(200),
    issuer: z.string().trim().max(200).optional(),
    issuedDate: z.string().trim().max(40).optional(),
  })
  .strict();

export const professionalSchema = z
  .object({
    masterResume: z.string().trim().max(50_000).optional(),
    workExperience: z.array(workExperienceSchema).max(100).default([]),
    education: z.array(educationSchema).max(50).default([]),
    skills: z.array(z.string().trim().min(1).max(80)).max(300).default([]),
    certifications: z.array(certificationSchema).max(100).default([]),
    projects: z.array(projectSchema).max(100).default([]),
    achievements: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
    portfolioLinks: z.array(z.string().trim().url()).max(50).default([]),
    github: optionalUrl,
    linkedin: optionalUrl,
  })
  .strict();

// ── Preferences ──────────────────────────────────────────────────────────────

export const workMode = z.enum(["remote", "hybrid", "onsite", "any"]);

export const preferencesSchema = z
  .object({
    titles: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    locations: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    salaryExpectation: z.string().trim().max(120).optional(),
    workMode: workMode.optional(),
    writingStyle: z.string().trim().max(5_000).optional(),
  })
  .strict();

// ── Aggregate ────────────────────────────────────────────────────────────────

/** Full profile write payload (PUT). */
export const profileInputSchema = z
  .object({
    personal: personalSchema,
    professional: professionalSchema,
    preferences: preferencesSchema,
  })
  .strict();

/** Partial section update payload (PATCH) — at least one section required. */
export const profilePatchSchema = z
  .object({
    personal: personalSchema.optional(),
    professional: professionalSchema.optional(),
    preferences: preferencesSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one of personal, professional, or preferences must be provided",
  });

export type Personal = z.infer<typeof personalSchema>;
export type Professional = z.infer<typeof professionalSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type ProfileInput = z.infer<typeof profileInputSchema>;
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

/** Full profile as returned to clients (decrypted), with metadata. */
export interface Profile extends ProfileInput {
  version: number;
  updatedAt: string;
}
