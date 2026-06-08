# Current State (Built)

> **Phase 0 — Foundations: complete.** **Phase 1 — Core Generation MVP: complete (2026-06-08).**
> 76/76 tests pass · typecheck/lint/build clean · live end-to-end verified (tracking + async
> queue/worker job lifecycle).

## What works today

- Single-user backend with **API-token auth** on every `/api` route.
- **Profile store** (single source of truth): full CRUD, versioning + history, PII encrypted at rest.
- **JD intake** (JD-1…JD-4): create an application from a **URL** (server fetches + strips HTML)
  or **pasted text**; the Claude CLI structures it into fields (synchronous, feeds the review step).
- **Generation** (GEN-1…GEN-4) via **BullMQ** async jobs: one combined "Generate" (resume +
  cover letter + answers) plus per-type **regeneration** with optional instructions. Grounded in
  profile + JD, no-fabrication contract enforced. Per-artifact **partial success**.
- **Tracking** (TRK-1/2/3, LC-1/2/3): auto-recorded applications, list/filter, detail
  (app + JD + artifacts + timeline), validated status transitions with a timeline.
- **Artifacts**: immutability-preserving edits (an edit creates a new version + repoints the app).
- Firefox extension **scaffold** (manifest + token-authenticated API client + ping stub). No UI.

## Live endpoints

Base URL `http://localhost:8787`. All `/api/*` require `Authorization: Bearer <token>`.

### Unauthenticated
| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | `200` when Postgres + Redis healthy, else `503` |

### Profile — `/api/profile`
| Method | Path | Notes |
|---|---|---|
| GET | `/api/profile` | `{profile: {…}|null}` (null before onboarding) |
| PUT | `/api/profile` | full replace/upsert → version N |
| PATCH | `/api/profile` | partial section update → version N+1 |
| GET | `/api/profile/versions` | history (newest first) |

### Applications & tracking — `/api/applications`
| Method | Path | Notes |
|---|---|---|
| POST | `/api/applications` | `{jobUrl?, jdText?, company?, role?}` → `201 {application, jobDescription}`. Sync JD extraction (CLI). |
| GET | `/api/applications` | filters: `status, company, q, from, to, limit, offset` → `{applications, total, limit, offset}` |
| GET | `/api/applications/:id` | `{application, jobDescription, artifacts, timeline}` |
| PATCH | `/api/applications/:id` | update `company/role/notes` |
| PATCH | `/api/applications/:id/status` | `{toStatus, note?}` → validated transition → `{application, event}` (409 if illegal) |
| DELETE | `/api/applications/:id` | `204`, cascades |
| GET | `/api/applications/:id/artifacts` | latest per type, or `?all=true` for all versions |
| POST | `/api/applications/:id/generate` | enqueue all 3 types → `202 {jobId, status, types}` |
| POST | `/api/applications/:id/generate/:type` | `type ∈ resume\|cover_letter\|answers`, `{instructions?}` → `202 {jobId}` |

### Artifacts — `/api/artifacts`
| Method | Path | Notes |
|---|---|---|
| PATCH | `/api/artifacts/:id` | `{content}` (validated by type) → new version, `editedByUser:true`, repoints app |

### Generation — `/api/generation`
| Method | Path | Notes |
|---|---|---|
| GET | `/api/generation/health` | AI-layer probe → `{ok, model, costUsd}` |
| GET | `/api/generation/jobs/:jobId` | poll a queued job → `{id, state, result?, failedReason?}` |

> Job results carry per-artifact `{type, status, artifactId?, version?, error?}` + `partial`.
> Artifacts persist in Postgres regardless of job TTL — `GET /api/applications/:id` is the
> durable source of truth; the job endpoint reports progress.

### Error envelope (all errors)
```jsonc
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "requestId": "uuid", "details"?: {…} } }
```
Codes → HTTP: `UNAUTHORIZED`→401 · `VALIDATION_ERROR`/`BAD_REQUEST`→400 · `NOT_FOUND`→404 ·
`CONFLICT`→409 · `UPSTREAM_ERROR`→502 · `TIMEOUT`→504 · `INTERNAL_ERROR`→500.

## File map (backend/src) — added in Phase 1

```
modules/jd/{jd.fetch,jd.schema,jd.prompts,jd.service}.ts   URL fetch + CLI-driven JD structuring
modules/application/{application.schema,application.repo,application.service,application.routes}.ts
modules/generation/{queue,worker,generation.service}.ts    BullMQ queue + in-process worker + orchestration
modules/generation/{prompts,generation.schema,generation.routes}.ts   extended (builders, JSON schemas, job route)
modules/artifact/{artifact.service,artifact.routes}.ts     immutability-preserving edits
lib/httpParams.ts                                          requireParam helper
```
(Phase 0 files unchanged except `config/env.ts`, `app.ts`, `index.ts` wiring.)

## How to run & verify

```bash
docker --context default compose up -d        # Postgres :5433, Redis :6380, creates rotom_test DB
cd backend
cp .env.example .env                           # set DATA_ENCRYPTION_KEY + a real ANTHROPIC_API_KEY
npm install && npm run migrate && npm run dev  # boots API + in-process generation worker
npm test                                       # 76 tests (rotom_test DB; CLI + queue mocked)
```

With a **real** `ANTHROPIC_API_KEY`: `POST /api/applications {jdText}` → `POST /:id/generate` →
poll `GET /api/generation/jobs/:jobId` → `completed` with artifacts; `GET /api/applications/:id`
shows them. (Verified live end-to-end; with a placeholder key the job still completes with
per-artifact `rejected` results — proving the queue/worker/orchestration path.)

## Explicitly deferred (NOT built)

Match summary (GEN-6) · voice calibration (GEN-7) · resume import/parse (PR-7) · JD re-extraction
(JD-6) · CSV/JSON export (TRK-6) · reminders (TRK-5) · all form automation + ATS adapters (Phase 2)
· all extension UI. (JD extraction is synchronous; only generation is queued.)
