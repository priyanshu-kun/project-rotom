import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mocks: avoid the real CLI (jd.service) and real Redis/BullMQ (queue) ──────
vi.mock("../src/modules/jd/jd.service.js", () => ({ extractStructuredJd: vi.fn() }));
vi.mock("../src/modules/generation/queue.js", () => ({
  enqueueGeneration: vi.fn(),
  getGenerationJob: vi.fn(),
  closeQueue: vi.fn(),
}));

const { createApp } = await import("../src/app.js");
const { closeDatabase, pingDatabase, query } = await import("../src/db/client.js");
const { sha256Hex } = await import("../src/lib/crypto.js");
const { __resetAuthCache } = await import("../src/modules/auth/auth.service.js");
const { runMigrations } = await import("../src/db/migrate.js");
const appRepo = await import("../src/modules/application/application.repo.js");
const { extractStructuredJd } = await import("../src/modules/jd/jd.service.js");
const { enqueueGeneration, getGenerationJob } = await import("../src/modules/generation/queue.js");
const { structuredJdSchema } = await import("../src/modules/jd/jd.schema.js");

let dbAvailable = false;
try {
  await pingDatabase();
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

const TOKEN = "rotom-phase1-token-abcdef0123456789";
const app = createApp();
const auth = { Authorization: `Bearer ${TOKEN}` };

const FIXED_JD = structuredJdSchema.parse({
  title: "Backend Engineer",
  company: "Acme",
  requiredSkills: ["Go", "Postgres"],
  questions: ["Why Acme?"],
  extractionConfidence: 0.8,
});

describe.skipIf(!dbAvailable)("Phase 1 API (integration)", () => {
  let applicationId: string;

  beforeAll(async () => {
    await runMigrations();
    await query("DELETE FROM users");
    await query("INSERT INTO users (token_hash) VALUES ($1)", [sha256Hex(TOKEN)]);
    __resetAuthCache();

    vi.mocked(extractStructuredJd).mockResolvedValue(FIXED_JD);
    vi.mocked(enqueueGeneration).mockResolvedValue("job-1");
    vi.mocked(getGenerationJob).mockResolvedValue({
      id: "job-1",
      state: "completed",
      result: { applicationId: "x", results: [], partial: false },
    });
  });

  afterAll(async () => {
    await query("DELETE FROM users");
    await closeDatabase();
  });

  it("creates an application from pasted JD text (TRK-1, JD-4)", async () => {
    const res = await request(app)
      .post("/api/applications")
      .set(auth)
      .send({ jdText: "We need a backend engineer with Go and Postgres experience..." });
    expect(res.status).toBe(201);
    expect(res.body.application.status).toBe("Saved");
    expect(res.body.application.company).toBe("Acme");
    expect(res.body.application.role).toBe("Backend Engineer");
    expect(res.body.jobDescription.requiredSkills).toContain("Go");
    expect(vi.mocked(extractStructuredJd)).toHaveBeenCalledOnce();
    applicationId = res.body.application.id;
  });

  it("lists applications (TRK-2)", async () => {
    const res = await request(app).get("/api/applications").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.applications).toHaveLength(1);
  });

  it("returns detail with JD + initial Saved timeline event", async () => {
    const res = await request(app).get(`/api/applications/${applicationId}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.jobDescription.title).toBe("Backend Engineer");
    expect(res.body.artifacts).toEqual([]);
    expect(res.body.timeline).toHaveLength(1);
    expect(res.body.timeline[0].toStatus).toBe("Saved");
  });

  it("transitions status and stamps dateApplied (TRK-3, LC-2)", async () => {
    const res = await request(app)
      .patch(`/api/applications/${applicationId}/status`)
      .set(auth)
      .send({ toStatus: "Applied", note: "Submitted via portal" });
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe("Applied");
    expect(res.body.application.dateApplied).not.toBeNull();
    expect(res.body.event.fromStatus).toBe("Saved");

    const detail = await request(app).get(`/api/applications/${applicationId}`).set(auth);
    expect(detail.body.timeline).toHaveLength(2);
  });

  it("rejects an illegal status transition with 409 (LC-3)", async () => {
    const res = await request(app)
      .patch(`/api/applications/${applicationId}/status`)
      .set(auth)
      .send({ toStatus: "Saved" }); // Applied -> Saved is illegal
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("enqueues a combined generation job (202)", async () => {
    const res = await request(app).post(`/api/applications/${applicationId}/generate`).set(auth);
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe("job-1");
    expect(res.body.types).toEqual(["resume", "cover_letter", "answers"]);
    expect(vi.mocked(enqueueGeneration)).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId, types: ["resume", "cover_letter", "answers"] }),
    );
  });

  it("reports generation job status", async () => {
    const res = await request(app).get("/api/generation/jobs/job-1").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("completed");
  });

  it("edits an artifact into a new immutable version and repoints (GEN-5/FORM-3)", async () => {
    const v1 = await appRepo.insertArtifactVersion({
      applicationId,
      type: "resume",
      content: { summary: "v1", highlightedSkills: [], experienceOrder: [], tailoringNotes: [] },
      version: 1,
      editedByUser: false,
    });
    await appRepo.setApplicationPointer(applicationId, "resume", v1.id);

    const res = await request(app)
      .patch(`/api/artifacts/${v1.id}`)
      .set(auth)
      .send({
        content: { summary: "edited", highlightedSkills: ["Go"], experienceOrder: [], tailoringNotes: [] },
      });
    expect(res.status).toBe(200);
    expect(res.body.artifact.version).toBe(2);
    expect(res.body.artifact.editedByUser).toBe(true);
    expect(res.body.artifact.id).not.toBe(v1.id);

    const detail = await request(app).get(`/api/applications/${applicationId}`).set(auth);
    expect(detail.body.application.resumeVersionId).toBe(res.body.artifact.id);
  });

  it("deletes an application (204) and cascades", async () => {
    const del = await request(app).delete(`/api/applications/${applicationId}`).set(auth);
    expect(del.status).toBe(204);
    const detail = await request(app).get(`/api/applications/${applicationId}`).set(auth);
    expect(detail.status).toBe(404);
  });
});
