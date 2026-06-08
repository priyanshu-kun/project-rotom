import { query, withTransaction } from "../../db/client.js";
import type {
  ApplicationRow,
  ApplicationStatus,
  ArtifactKind,
  ArtifactRow,
  JobDescriptionRow,
  StatusEventRow,
} from "../../db/schema.js";
import type { StructuredJd } from "../jd/jd.schema.js";
import type { ListQuery, UpdateApplicationInput } from "./application.schema.js";

// ── Column lists (snake_case → camelCase aliases matching the row types) ──────

const APPLICATION_COLUMNS = `
  id,
  user_id                 AS "userId",
  company,
  role,
  job_url                 AS "jobUrl",
  status,
  date_applied            AS "dateApplied",
  resume_version_id       AS "resumeVersionId",
  cover_letter_version_id AS "coverLetterVersionId",
  notes,
  created_at              AS "createdAt"`;

const JD_COLUMNS = `
  id,
  application_id          AS "applicationId",
  title,
  company,
  location,
  responsibilities,
  required_skills         AS "requiredSkills",
  preferred_skills        AS "preferredSkills",
  qualifications,
  keywords,
  questions,
  form_fields             AS "formFields",
  extraction_confidence   AS "extractionConfidence",
  created_at              AS "createdAt"`;

const ARTIFACT_COLUMNS = `
  id,
  application_id          AS "applicationId",
  type,
  content,
  version,
  edited_by_user          AS "editedByUser",
  generated_at            AS "generatedAt"`;

const STATUS_EVENT_COLUMNS = `
  id,
  application_id          AS "applicationId",
  from_status             AS "fromStatus",
  to_status               AS "toStatus",
  note,
  created_at              AS "createdAt"`;

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
  return withTransaction(async (client) => {
    const insertedApp = await client.query<ApplicationRow>(
      `INSERT INTO applications (user_id, company, role, job_url, status)
            VALUES ($1, $2, $3, $4, 'Saved')
         RETURNING ${APPLICATION_COLUMNS}`,
      [userId, fields.company, fields.role, fields.jobUrl],
    );
    const application = insertedApp.rows[0]!;

    await client.query(
      `INSERT INTO job_descriptions
         (application_id, title, company, location, responsibilities, required_skills,
          preferred_skills, qualifications, keywords, questions, form_fields, extraction_confidence)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12)`,
      [
        application.id,
        jd.title,
        jd.company,
        jd.location,
        JSON.stringify(jd.responsibilities),
        JSON.stringify(jd.requiredSkills),
        JSON.stringify(jd.preferredSkills),
        JSON.stringify(jd.qualifications),
        JSON.stringify(jd.keywords),
        JSON.stringify(jd.questions),
        JSON.stringify(jd.formFields),
        jd.extractionConfidence,
      ],
    );

    await client.query(
      `INSERT INTO status_events (application_id, from_status, to_status, note)
            VALUES ($1, NULL, 'Saved', $2)`,
      [application.id, "Application created"],
    );

    return { application, jobDescription: jd };
  });
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function findById(userId: string, id: string): Promise<ApplicationRow | null> {
  const rows = await query<ApplicationRow>(
    `SELECT ${APPLICATION_COLUMNS} FROM applications WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId],
  );
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
    query<JobDescriptionRow>(
      `SELECT ${JD_COLUMNS} FROM job_descriptions WHERE application_id = $1 LIMIT 1`,
      [id],
    ),
    query<ArtifactRow>(
      `SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE application_id = $1 ORDER BY generated_at ASC`,
      [id],
    ),
    query<StatusEventRow>(
      `SELECT ${STATUS_EVENT_COLUMNS} FROM status_events WHERE application_id = $1 ORDER BY created_at ASC`,
      [id],
    ),
  ]);
  return {
    application,
    jobDescription: jdRows[0] ? jdRowToStructured(jdRows[0]) : null,
    artifacts: artifactRows,
    timeline,
  };
}

export async function getStructuredJd(applicationId: string): Promise<StructuredJd | null> {
  const rows = await query<JobDescriptionRow>(
    `SELECT ${JD_COLUMNS} FROM job_descriptions WHERE application_id = $1 LIMIT 1`,
    [applicationId],
  );
  return rows[0] ? jdRowToStructured(rows[0]) : null;
}

export async function list(
  userId: string,
  filters: ListQuery,
): Promise<{ items: ApplicationRow[]; total: number }> {
  const conditions: string[] = ["user_id = $1"];
  const params: unknown[] = [userId];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.company) {
    params.push(`%${filters.company}%`);
    conditions.push(`company ILIKE $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    conditions.push(`(company ILIKE $${params.length} OR role ILIKE $${params.length})`);
  }
  if (filters.from) {
    params.push(filters.from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    conditions.push(`created_at <= $${params.length}`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const [items, totalRows] = await Promise.all([
    query<ApplicationRow>(
      `SELECT ${APPLICATION_COLUMNS} FROM applications ${where}
         ORDER BY created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, filters.limit, filters.offset],
    ),
    query<{ value: number }>(`SELECT COUNT(*)::int AS value FROM applications ${where}`, params),
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
  return withTransaction(async (client) => {
    const updated = await client.query<ApplicationRow>(
      `UPDATE applications
          SET status = $1${stampDateApplied ? ", date_applied = now()" : ""}
        WHERE id = $2
      RETURNING ${APPLICATION_COLUMNS}`,
      [toStatus, id],
    );
    const insertedEvent = await client.query<StatusEventRow>(
      `INSERT INTO status_events (application_id, from_status, to_status, note)
            VALUES ($1, $2, $3, $4)
         RETURNING ${STATUS_EVENT_COLUMNS}`,
      [id, fromStatus, toStatus, note ?? null],
    );
    return { application: updated.rows[0]!, event: insertedEvent.rows[0]! };
  });
}

export async function updateFields(
  userId: string,
  id: string,
  fields: UpdateApplicationInput,
): Promise<ApplicationRow | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const column of ["company", "role", "notes"] as const) {
    const value = fields[column];
    if (value !== undefined) {
      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    }
  }
  // Nothing to change — return the current row (ownership-scoped) unchanged.
  if (setClauses.length === 0) {
    return findById(userId, id);
  }

  params.push(id, userId);
  const rows = await query<ApplicationRow>(
    `UPDATE applications SET ${setClauses.join(", ")}
      WHERE id = $${params.length - 1} AND user_id = $${params.length}
    RETURNING ${APPLICATION_COLUMNS}`,
    params,
  );
  return rows[0] ?? null;
}

export async function deleteById(userId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM applications WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId],
  );
  return rows.length > 0;
}

// ── Artifacts ────────────────────────────────────────────────────────────────

export async function latestArtifactVersion(
  applicationId: string,
  type: ArtifactKind,
): Promise<number> {
  const rows = await query<{ version: number }>(
    `SELECT version FROM artifacts
      WHERE application_id = $1 AND type = $2
      ORDER BY version DESC
      LIMIT 1`,
    [applicationId, type],
  );
  return rows[0]?.version ?? 0;
}

export async function insertArtifactVersion(input: {
  applicationId: string;
  type: ArtifactKind;
  content: unknown;
  version: number;
  editedByUser: boolean;
}): Promise<ArtifactRow> {
  const rows = await query<ArtifactRow>(
    `INSERT INTO artifacts (application_id, type, content, version, edited_by_user)
          VALUES ($1, $2, $3::jsonb, $4, $5)
       RETURNING ${ARTIFACT_COLUMNS}`,
    [input.applicationId, input.type, JSON.stringify(input.content), input.version, input.editedByUser],
  );
  return rows[0]!;
}

/** Point the application at the artifact version used (resume / cover letter). */
export async function setApplicationPointer(
  applicationId: string,
  type: ArtifactKind,
  artifactId: string,
): Promise<void> {
  if (type === "resume") {
    await query(`UPDATE applications SET resume_version_id = $1 WHERE id = $2`, [
      artifactId,
      applicationId,
    ]);
  } else if (type === "cover_letter") {
    await query(`UPDATE applications SET cover_letter_version_id = $1 WHERE id = $2`, [
      artifactId,
      applicationId,
    ]);
  }
  // 'answer' artifacts have no dedicated pointer column.
}

export async function listArtifacts(
  applicationId: string,
  options: { all: boolean },
): Promise<ArtifactRow[]> {
  const rows = await query<ArtifactRow>(
    `SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE application_id = $1 ORDER BY version DESC`,
    [applicationId],
  );
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
  const rows = await query<ArtifactRow & { ownerId: string }>(
    `SELECT art.id,
            art.application_id AS "applicationId",
            art.type,
            art.content,
            art.version,
            art.edited_by_user AS "editedByUser",
            art.generated_at   AS "generatedAt",
            app.user_id        AS "ownerId"
       FROM artifacts art
       JOIN applications app ON art.application_id = app.id
      WHERE art.id = $1
      LIMIT 1`,
    [artifactId],
  );
  const row = rows[0];
  if (!row || row.ownerId !== userId) {
    return null;
  }
  const { ownerId, ...artifact } = row;
  return { artifact, ownerId };
}
