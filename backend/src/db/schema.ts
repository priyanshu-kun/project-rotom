import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Full Project Rotom data model (PRD §11). Phase 0 implements feature endpoints
 * only for `profiles`; the remaining tables are created now so the schema is
 * complete and later phases need no destructive migration.
 *
 * Nested profile sub-entities (work experience, education, …) live inside jsonb
 * columns validated by Zod at the application boundary — a deliberate document
 * model that avoids premature normalization for a single-user product.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

/** Application lifecycle statuses (PRD LC-1). */
export const applicationStatus = pgEnum("application_status", [
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
]);

export const artifactType = pgEnum("artifact_type", ["resume", "cover_letter", "answer"]);

// ── Users & auth ───────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // SHA-256 hex of the single API token (PRD: single-user, local token auth).
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Profile (single source of truth) ────────────────────────────────────────

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  // Encrypted-at-rest envelope (AES-256-GCM) of the personal PII block.
  personal: jsonb("personal").notNull(),
  professional: jsonb("professional").notNull(),
  preferences: jsonb("preferences").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only snapshots backing profile versioning (PR-6). */
export const profileHistory = pgTable(
  "profile_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    // Full profile snapshot (personal block remains encrypted).
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("profile_history_user_version_uq").on(table.userId, table.version),
    index("profile_history_user_idx").on(table.userId),
  ],
);

// ── Applications ───────────────────────────────────────────────────────────

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    company: text("company").notNull(),
    role: text("role").notNull(),
    jobUrl: text("job_url"),
    status: applicationStatus("status").notNull().default("Saved"),
    dateApplied: timestamp("date_applied", { withTimezone: true }),
    // Nullable FKs to the immutable artifact versions used for this application.
    resumeVersionId: uuid("resume_version_id"),
    coverLetterVersionId: uuid("cover_letter_version_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("applications_user_idx").on(table.userId)],
);

export const jobDescriptions = pgTable("job_descriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id")
    .notNull()
    .unique()
    .references(() => applications.id, { onDelete: "cascade" }),
  title: text("title"),
  company: text("company"),
  location: text("location"),
  responsibilities: jsonb("responsibilities").notNull().default(sql`'[]'::jsonb`),
  requiredSkills: jsonb("required_skills").notNull().default(sql`'[]'::jsonb`),
  preferredSkills: jsonb("preferred_skills").notNull().default(sql`'[]'::jsonb`),
  qualifications: jsonb("qualifications").notNull().default(sql`'[]'::jsonb`),
  keywords: jsonb("keywords").notNull().default(sql`'[]'::jsonb`),
  questions: jsonb("questions").notNull().default(sql`'[]'::jsonb`),
  formFields: jsonb("form_fields").notNull().default(sql`'[]'::jsonb`),
  extractionConfidence: real("extraction_confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    type: artifactType("type").notNull(),
    // Structured artifact payload (resume sections / cover letter / Q&A).
    content: jsonb("content").notNull(),
    version: integer("version").notNull().default(1),
    editedByUser: boolean("edited_by_user").notNull().default(false),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("artifacts_application_type_version_uq").on(
      table.applicationId,
      table.type,
      table.version,
    ),
    index("artifacts_application_idx").on(table.applicationId),
  ],
);

export const statusEvents = pgTable(
  "status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    fromStatus: applicationStatus("from_status"),
    toStatus: applicationStatus("to_status").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("status_events_application_idx").on(table.applicationId)],
);

// ── Inferred row types ───────────────────────────────────────────────────────

export type UserRow = typeof users.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type ProfileInsert = typeof profiles.$inferInsert;
export type ProfileHistoryRow = typeof profileHistory.$inferSelect;
export type ApplicationRow = typeof applications.$inferSelect;
export type JobDescriptionRow = typeof jobDescriptions.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type StatusEventRow = typeof statusEvents.$inferSelect;

export type ApplicationStatus = (typeof applicationStatus.enumValues)[number];
export type ArtifactKind = (typeof artifactType.enumValues)[number];
