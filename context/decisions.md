# Decisions (ADR-lite)

Chronological record of the choices that shaped the build. Append new entries; don't rewrite
history.

## D1 — Scope the first build to Phase 0 only
**Decision:** Implement Phase 0 (Foundations) only — backend skeleton, full data model, profile
system, auth, and the Claude CLI integration contract. No generation flow, JD extraction, form
automation, tracking endpoints, or extension UI.
**Why:** The PRD spans Phases 0–4; building a vertical slice of foundations first de-risks every
later phase and gives a verifiable base. (User-selected.)

## D2 — AI layer is the Claude Code CLI subprocess
**Decision:** The backend invokes the `claude` CLI headlessly as a subprocess per generation,
behind a swappable `GenerationProvider` interface.
**Why:** PRD literally specifies the Claude Code CLI as the AI layer. The interface keeps an
Anthropic-SDK adapter as a drop-in future option without touching callers.
**Hardening:** args array (no shell), prompt via stdin, `--tools ""`, `--bare`,
`--no-session-persistence`, throwaway cwd, minimal env, SIGKILL timeout, `is_error`-aware
parsing, `--json-schema` + Zod post-validation with one retry.

## D3 — Single-user, local API-token auth (no login UI)
**Decision:** One user per deployment. Token comes from `API_TOKEN` env, else `.rotom-token`,
else generated on first boot. Only the SHA-256 **hash** is stored; verification is constant-time.
**Why:** Product is single-user/single-profile by definition (non-goal: multi-user). Avoids
building real auth UI for v1.

## D4 — Two separate projects (no shared package)
**Decision:** `backend/` and `extension/` are independent npm projects. The canonical data
contract (Zod schemas + inferred types) lives in the backend.
**Why:** User-selected. Keeps the extension's toolchain independent; acceptable duplication of a
few client types for a single-user product.

## D5 — Drizzle ORM with jsonb document columns for the profile
**Decision:** Typed Drizzle schema as the SQL source of truth; nested profile sub-entities
(experience, education, …) stored as Zod-validated `jsonb`, not normalized tables.
**Why:** Type-safety + real migrations; the profile is naturally a document and a single-user
product doesn't need relational decomposition yet.

## D6 — Encrypt PII at rest at the application layer
**Decision:** AES-256-GCM encrypt the `personal` block before persistence (live row + history
snapshot); key from `DATA_ENCRYPTION_KEY` (base64 32-byte). A versioned envelope `{v,iv,tag,data}`.
**Why:** PRD §9.3/§12 require encryption at rest; app-level field encryption is verifiable and
key-rotatable, and an integration test asserts the raw row contains no plaintext.

## D7 — ESM with NodeNext + split tsconfig
**Decision:** `module/moduleResolution: NodeNext` with explicit `.js` import extensions; a base
`tsconfig.json` (src+test, noEmit) for lint/typecheck and a `tsconfig.build.json` for `dist`.
**Why:** Makes `tsc` → `node dist` actually runnable as ESM, while letting the type-checked
linter see test files.

## D8 — Local infra ports remapped; isolated test database
**Decision:** docker-compose publishes Postgres on **5433** and Redis on **6380**; tests run
against a dedicated **`rotom_test`** DB created by `db-init/01-create-test-db.sql`.
**Why:** The host already runs native Postgres :5432 / Redis :6379, and the test suite wipes
`users` in `beforeAll` — it must never touch the dev `rotom` DB. (See project memory:
"docker-context-and-ports" — on this machine use `docker --context default`.)

## D9 — Generation feature endpoints deferred, contract proven via health probe
**Decision:** Ship only `GET /api/generation/health` in Phase 0; defer
resume/cover-letter/answer endpoints to Phase 1.
**Why:** Phase 0's deliverable is the *contract*, not the feature. The probe verifies the whole
chain (binary, auth, envelope, structured validation) without committing to generation UX.

## D10 — Generation is async (BullMQ); JD extraction is synchronous
**Decision:** Content generation (~10–60s) runs as **BullMQ jobs** on the existing Redis with an
**in-process worker**; clients enqueue then poll `GET /api/generation/jobs/:jobId`. JD extraction
(~5s, one CLI call) runs **synchronously** inside `POST /api/applications`.
**Why:** Generation is too long to hold an HTTP request and benefits from queueing/concurrency
control + per-artifact partial success (NFR 9.2). Extraction is fast and feeds the create→review
step, so a synchronous call keeps that UX simple. The worker is in-process for single-user
simplicity and can be split out later (same queue name + connection).

## D11 — Per-artifact partial success, not whole-batch failure
**Decision:** A combined generation job runs the three artifact types under `Promise.allSettled`;
the job *completes* with a per-type `{status, artifactId?, error?}` result + a `partial` flag even
if some types fail.
**Why:** PRD NFR 9.2 — a failed cover letter must not discard a good resume. Verified live: with an
invalid API key the job still completes with all-rejected results rather than crashing.

## D12 — Artifacts are immutable; edits create a new version
**Decision:** `PATCH /api/artifacts/:id` validates the new content against the artifact's type and
inserts a **new version** (`editedByUser:true`), then repoints the application — it never mutates
the existing row.
**Why:** PRD §11 — artifact versions referenced by a submission must be immutable; this preserves
an auditable history of exactly what was used while allowing inline edits before submit.

## D13 — Single ioredis copy via npm `overrides`
**Decision:** `"overrides": { "ioredis": "$ioredis" }` forces BullMQ's bundled ioredis to dedupe
to the project's direct dependency.
**Why:** BullMQ pinned a different ioredis patch, producing a second copy whose types clashed with
ours (`Redis` not assignable to `ConnectionOptions`). Deduping fixes it cleanly without casts.
