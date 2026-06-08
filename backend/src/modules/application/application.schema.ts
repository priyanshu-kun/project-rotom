import { z } from "zod";
import { APPLICATION_STATUSES, ARTIFACT_TYPES } from "../../db/schema.js";

/** Create from a URL (server fetches + extracts) or pasted JD text (JD-1/JD-4). */
export const createApplicationSchema = z
  .object({
    jobUrl: z.string().trim().url().optional(),
    jdText: z.string().trim().min(1).max(100_000).optional(),
    company: z.string().trim().min(1).max(200).optional(),
    role: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.jobUrl) || Boolean(value.jdText), {
    message: "Provide either jobUrl or jdText",
  });

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const updateStatusSchema = z
  .object({
    toStatus: z.enum(APPLICATION_STATUSES),
    note: z.string().trim().max(2_000).optional(),
  })
  .strict();

export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

export const updateApplicationSchema = z
  .object({
    company: z.string().trim().min(1).max(200).optional(),
    role: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().max(10_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

export const listQuerySchema = z
  .object({
    status: z.enum(APPLICATION_STATUSES).optional(),
    company: z.string().trim().min(1).max(200).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type ListQuery = z.infer<typeof listQuerySchema>;

/** Generation targets — must align with the artifact_type enum (answers→answer). */
export const generationType = z.enum(["resume", "cover_letter", "answers"]);
export type GenerationType = z.infer<typeof generationType>;

export { ARTIFACT_TYPES };
