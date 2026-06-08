/**
 * Data model types & enum value lists for Project Rotom (PRD §11).
 *
 * This module is the TypeScript-side source of truth for row shapes and enum
 * values. The SQL source of truth lives in `migrations/*.sql`; the two are kept
 * in sync by hand (no ORM). Phase 0 implements feature endpoints only for
 * `profiles`; the remaining row types back tables created now so later phases
 * need no destructive migration.
 *
 * Row interfaces describe what repos return: columns are aliased to camelCase in
 * every SELECT/RETURNING, and `jsonb` columns are auto-parsed by node-pg into JS
 * values (typed `unknown` here, narrowed via Zod at the application boundary).
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

/** Application lifecycle statuses (PRD LC-1). Mirrors the `application_status` enum. */
export const APPLICATION_STATUSES = [
  "Saved",
  "Applying",
  "Applied",
  "Under Review",
  "Assessment Received",
  "Recruiter Contacted",
  "Interview Scheduled",
  "Technical Interview",
  "Final Interview",
  "Offer Received",
  "Rejected",
  "Accepted",
  "Withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Artifact kinds. Mirrors the `artifact_type` enum. */
export const ARTIFACT_TYPES = ["resume", "cover_letter", "answer"] as const;

export type ArtifactKind = (typeof ARTIFACT_TYPES)[number];

// ── Row types ─────────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  tokenHash: string;
  createdAt: Date;
}

export interface ProfileRow {
  id: string;
  userId: string;
  /** Encrypted-at-rest envelope (AES-256-GCM) of the personal PII block. */
  personal: unknown;
  professional: unknown;
  preferences: unknown;
  version: number;
  updatedAt: Date;
}

export interface ProfileHistoryRow {
  id: string;
  userId: string;
  version: number;
  /** Full profile snapshot; the personal block remains encrypted. */
  snapshot: unknown;
  createdAt: Date;
}

export interface ApplicationRow {
  id: string;
  userId: string;
  company: string;
  role: string;
  jobUrl: string | null;
  status: ApplicationStatus;
  dateApplied: Date | null;
  resumeVersionId: string | null;
  coverLetterVersionId: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface JobDescriptionRow {
  id: string;
  applicationId: string;
  title: string | null;
  company: string | null;
  location: string | null;
  responsibilities: unknown;
  requiredSkills: unknown;
  preferredSkills: unknown;
  qualifications: unknown;
  keywords: unknown;
  questions: unknown;
  formFields: unknown;
  extractionConfidence: number | null;
  createdAt: Date;
}

export interface ArtifactRow {
  id: string;
  applicationId: string;
  type: ArtifactKind;
  content: unknown;
  version: number;
  editedByUser: boolean;
  generatedAt: Date;
}

export interface StatusEventRow {
  id: string;
  applicationId: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  note: string | null;
  createdAt: Date;
}
