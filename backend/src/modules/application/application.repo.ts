import { and, asc, count, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  applications,
  artifacts,
  jobDescriptions,
  statusEvents,
  type ApplicationRow,
  type ApplicationStatus,
  type ArtifactKind,
  type ArtifactRow,
  type JobDescriptionRow,
  type StatusEventRow,
} from "../../db/schema.js";
import type { StructuredJd } from "../jd/jd.schema.js";
import type { ListQuery, UpdateApplicationInput } from "./application.schema.js";

// ── JD row <-> StructuredJd mapping ──────────────────────────────────────────

function jdRowToStructured(row: JobDescriptionRow): StructuredJd {
  return {
    title: row.title,
    company: row.company,
    location: row.location,
    responsibilities: row.responsibilities as string[],
    requiredSkills: row.requiredSkills as string[],
    preferredSkills: row.preferredSkills as string[],
    qualifications: row.qualifications as string[],
    keywords: row.keywords as string[],
    questions: row.questions as string[],
    formFields: row.formFields as string[],
    extractionConfidence: row.extractionConfidence ?? 0,
  };
}

function structuredToJdValues(applicationId: string, jd: StructuredJd) {
  return {
    applicationId,
    title: jd.title,
    company: jd.company,
    location: jd.location,
    responsibilities: jd.responsibilities,
    requiredSkills: jd.requiredSkills,
    preferredSkills: jd.preferredSkills,
    qualifications: jd.qualifications,
    keywords: jd.keywords,
    questions: jd.questions,
    formFields: jd.formFields,
    extractionConfidence: jd.extractionConfidence,
  };
}

// ── Create ───────────────────────────────────────────────────────────────────

export interface CreatedApplication {
  application: ApplicationRow;
  jobDescription: StructuredJd;
}

/**
 * Create an application + its job description + the initial "Saved" timeline
 * event in one transaction (TRK-1, LC-2).
 */
export async function createWithJd(
  userId: string,
  fields: { company: string; role: string; jobUrl: string | null },
  jd: StructuredJd,
): Promise<CreatedApplication> {
  return db.transaction(async (tx) => {
    const insertedApp = await tx
      .insert(applications)
      .values({
        userId,
        company: fields.company,
        role: fields.role,
        jobUrl: fields.jobUrl,
        status: "Saved",
      })
      .returning();
    const application = insertedApp[0]!;

    await tx.insert(jobDescriptions).values(structuredToJdValues(application.id, jd));
    await tx.insert(statusEvents).values({
      applicationId: application.id,
      fromStatus: null,
      toStatus: "Saved",
      note: "Application created",
    });

    return { application, jobDescription: jd };
  });
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function findById(userId: string, id: string): Promise<ApplicationRow | null> {
  const rows = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, id), eq(applications.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface ApplicationDetail {
  application: ApplicationRow;
  jobDescription: StructuredJd | null;
  artifacts: ArtifactRow[];
  timeline: StatusEventRow[];
}

export async function getDetail(userId: string, id: string): Promise<ApplicationDetail | null> {
  const application = await findById(userId, id);
  if (!application) {
    return null;
  }
  const [jdRows, artifactRows, timeline] = await Promise.all([
    db.select().from(jobDescriptions).where(eq(jobDescriptions.applicationId, id)).limit(1),
    db.select().from(artifacts).where(eq(artifacts.applicationId, id)).orderBy(asc(artifacts.generatedAt)),
    db
      .select()
      .from(statusEvents)
      .where(eq(statusEvents.applicationId, id))
      .orderBy(asc(statusEvents.createdAt)),
  ]);
  return {
    application,
    jobDescription: jdRows[0] ? jdRowToStructured(jdRows[0]) : null,
    artifacts: artifactRows,
    timeline,
  };
}

export async function getStructuredJd(applicationId: string): Promise<StructuredJd | null> {
  const rows = await db
    .select()
    .from(jobDescriptions)
    .where(eq(jobDescriptions.applicationId, applicationId))
    .limit(1);
  return rows[0] ? jdRowToStructured(rows[0]) : null;
}

export async function list(
  userId: string,
  filters: ListQuery,
): Promise<{ items: ApplicationRow[]; total: number }> {
  const conditions = [eq(applications.userId, userId)];
  if (filters.status) {
    conditions.push(eq(applications.status, filters.status));
  }
  if (filters.company) {
    conditions.push(ilike(applications.company, `%${filters.company}%`));
  }
  if (filters.q) {
    const term = `%${filters.q}%`;
    conditions.push(or(ilike(applications.company, term), ilike(applications.role, term))!);
  }
  if (filters.from) {
    conditions.push(gte(applications.createdAt, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(applications.createdAt, filters.to));
  }
  const where = and(...conditions);

  const [items, totalRows] = await Promise.all([
    db
      .select()
      .from(applications)
      .where(where)
      .orderBy(desc(applications.createdAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ value: count() }).from(applications).where(where),
  ]);
  return { items, total: totalRows[0]?.value ?? 0 };
}

// ── Status & field updates ───────────────────────────────────────────────────

export interface StatusUpdateResult {
  application: ApplicationRow;
  event: StatusEventRow;
}

export async function applyStatusTransition(
  id: string,
  fromStatus: ApplicationStatus,
  toStatus: ApplicationStatus,
  note: string | undefined,
  stampDateApplied: boolean,
): Promise<StatusUpdateResult> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(applications)
      .set({
        status: toStatus,
        ...(stampDateApplied ? { dateApplied: new Date() } : {}),
      })
      .where(eq(applications.id, id))
      .returning();
    const insertedEvent = await tx
      .insert(statusEvents)
      .values({ applicationId: id, fromStatus, toStatus, note: note ?? null })
      .returning();
    return { application: updated[0]!, event: insertedEvent[0]! };
  });
}

export async function updateFields(
  userId: string,
  id: string,
  fields: UpdateApplicationInput,
): Promise<ApplicationRow | null> {
  // Build a clean set object with only defined keys (drizzle's set() rejects
  // explicit undefined under exactOptionalPropertyTypes).
  const updates: Partial<Pick<ApplicationRow, "company" | "role" | "notes">> = {};
  if (fields.company !== undefined) {
    updates.company = fields.company;
  }
  if (fields.role !== undefined) {
    updates.role = fields.role;
  }
  if (fields.notes !== undefined) {
    updates.notes = fields.notes;
  }
  const rows = await db
    .update(applications)
    .set(updates)
    .where(and(eq(applications.id, id), eq(applications.userId, userId)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteById(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(applications)
    .where(and(eq(applications.id, id), eq(applications.userId, userId)))
    .returning({ id: applications.id });
  return rows.length > 0;
}

// ── Artifacts ────────────────────────────────────────────────────────────────

export async function latestArtifactVersion(
  applicationId: string,
  type: ArtifactKind,
): Promise<number> {
  const rows = await db
    .select({ version: artifacts.version })
    .from(artifacts)
    .where(and(eq(artifacts.applicationId, applicationId), eq(artifacts.type, type)))
    .orderBy(desc(artifacts.version))
    .limit(1);
  return rows[0]?.version ?? 0;
}

export async function insertArtifactVersion(input: {
  applicationId: string;
  type: ArtifactKind;
  content: unknown;
  version: number;
  editedByUser: boolean;
}): Promise<ArtifactRow> {
  const rows = await db
    .insert(artifacts)
    .values({
      applicationId: input.applicationId,
      type: input.type,
      content: input.content,
      version: input.version,
      editedByUser: input.editedByUser,
    })
    .returning();
  return rows[0]!;
}

/** Point the application at the artifact version used (resume / cover letter). */
export async function setApplicationPointer(
  applicationId: string,
  type: ArtifactKind,
  artifactId: string,
): Promise<void> {
  if (type === "resume") {
    await db
      .update(applications)
      .set({ resumeVersionId: artifactId })
      .where(eq(applications.id, applicationId));
  } else if (type === "cover_letter") {
    await db
      .update(applications)
      .set({ coverLetterVersionId: artifactId })
      .where(eq(applications.id, applicationId));
  }
  // 'answer' artifacts have no dedicated pointer column.
}

export async function listArtifacts(
  applicationId: string,
  options: { all: boolean },
): Promise<ArtifactRow[]> {
  const rows = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.applicationId, applicationId))
    .orderBy(desc(artifacts.version));
  if (options.all) {
    return rows;
  }
  // Latest version per type.
  const seen = new Set<ArtifactKind>();
  const latest: ArtifactRow[] = [];
  for (const row of rows) {
    if (!seen.has(row.type)) {
      seen.add(row.type);
      latest.push(row);
    }
  }
  return latest;
}

export async function findArtifactForUser(
  userId: string,
  artifactId: string,
): Promise<{ artifact: ArtifactRow; ownerId: string } | null> {
  const rows = await db
    .select({ artifact: artifacts, ownerId: applications.userId })
    .from(artifacts)
    .innerJoin(applications, eq(artifacts.applicationId, applications.id))
    .where(eq(artifacts.id, artifactId))
    .limit(1);
  const row = rows[0];
  if (!row || row.ownerId !== userId) {
    return null;
  }
  return { artifact: row.artifact, ownerId: row.ownerId };
}
