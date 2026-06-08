# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AI-assisted job-application Firefox extension + backend. **The repo currently implements Phase 0 — Foundations only.** Many database tables and helpers exist for entities whose feature endpoints are deliberately deferred to later phases (see "Phase 0 scope" below). When asked to extend the system, check whether the groundwork already exists before adding new tables.

## Repo layout

Two independent npm packages, no root workspace — install/run each separately:

- `backend/` — Node 20+ / TypeScript / Express service. The focus of Phase 0. Run all `npm` scripts from here.
- `extension/` — Firefox MV3 scaffold (manifest + token-authenticated API client). No UI yet; `npm run typecheck` is the only script.
- `db-init/` — SQL run on first Postgres init; creates the `rotom_test` database for test isolation.
- `docker-compose.yml` — Postgres + Redis for local dev.

## Commands (run from `backend/`)

```bash
docker compose up -d              # from repo root: start Postgres + Redis first
npm run dev                       # tsx watch; prints the API token once on first boot
npm run build && npm start        # compile to dist/ then run with node
npm run migrate                   # apply SQL migrations (tsx src/db/migrate.ts)
npm run migrate:generate          # diff schema.ts → new SQL migration in drizzle/
npm run db:seed                   # idempotent auth bootstrap (creates user + token)
npm run lint                      # eslint
npm run typecheck                 # tsc --noEmit
npm run test                      # vitest run (needs Postgres + Redis up)
npm run test:watch
npx vitest run test/crypto.test.ts            # single file
npx vitest run -t "constant-time"             # single test by name
```

Docker/port specifics (Postgres **5433**, Redis **6380**, test DB `rotom_test`) are in the auto-memory; honor them.

### Test prerequisites

Integration tests (`profile.integration.test.ts`) hit a **real** Postgres at the `rotom_test` DB and run **serially** (`fileParallelism: false`) — start Docker first. `vitest.config.ts` injects a fixed `DATA_ENCRYPTION_KEY` and `NODE_ENV=test`; `src/config/env.ts` validates env at import time, so tests fail fast if the schema isn't satisfied. The claude CLI is never spawned in tests — `claudeCli.provider.test.ts` stubs the subprocess.

## Architecture

### Layering (backend)

`src/app.ts` builds the Express app with **no side effects** (no `listen`, no DB/Redis connection) so integration tests import it directly. `src/index.ts` owns the process: ping Postgres → connect Redis → `bootstrapAuth()` → `listen` → register graceful shutdown.

Each feature is a module under `src/modules/<name>/` split into **routes → service → repo**:
- **routes** — HTTP only: parse with Zod `.safeParse`, throw `ValidationError` on failure, call the service. Read the user via `userIdOf(req)` (populated by `requireAuth`).
- **service** — business logic; **re-validates input** with `.parse` so it's safe to call from non-HTTP contexts.
- **repo** — Drizzle queries; the boundary where encryption/decryption happens.

### Auth — single-user API token

No login UI. `bootstrapAuth()` resolves a token (priority: `API_TOKEN` env → existing `.rotom-token` file → freshly generated, written 0600) and ensures exactly one `users` row whose `token_hash` is the SHA-256 of it. Only the hash is persisted. `requireAuth` middleware verifies `Authorization: Bearer <token>` in **constant time** (`safeHexEqual`) and attaches `req.userId`. The verified user is cached in-process; reset it in tests via `__resetAuthCache()`.

### Data model & the document pattern

`src/db/schema.ts` defines the **full** PRD data model in Drizzle, but Phase 0 only wires endpoints for `profiles`. Nested sub-entities (work experience, education, JD fields, artifact content) live in **`jsonb` columns validated by Zod at the boundary** — a deliberate document model, not normalized tables. Don't normalize these into new tables for a single-user product without reason.

Migrations live in `drizzle/` and are **SQL files generated from `schema.ts`** — edit the schema then run `migrate:generate`, never hand-write migrations.

### Profile — versioning & encryption

The profile is the single source of truth. `upsertWithHistory` runs in **one transaction**: it `SELECT ... FOR UPDATE`s the current version, bumps it, upserts the live row, and appends an immutable `profile_history` snapshot — the row and snapshot can never diverge. PUT replaces wholesale; PATCH replaces provided sections wholesale (arrays like skills are **not** deep-merged). The `personal` block is **encrypted at rest** (AES-256-GCM, self-describing versioned envelope via `src/lib/crypto.ts`) in both the live row and every snapshot; `findByUserId` decrypts transparently, `listVersions` never decrypts.

### Generation (AI layer) — provider abstraction

`GenerationProvider` (`src/modules/generation/provider.ts`) is the swappable boundary; Phase 0 ships `ClaudeCliProvider`, which spawns the `claude` CLI as a **sandboxed pure-text generator**. Critical hardening to preserve when touching `claudeCli.provider.ts`:
- args as an array (no shell); prompt via **stdin** (not argv); `--tools ""` disables all tools; `--bare --no-session-persistence`; throwaway temp cwd; minimal env (PATH/HOME/`ANTHROPIC_API_KEY`); hard SIGKILL timeout; 10 MB stdout cap.
- A failed run can **exit 0 with `is_error: true`** — that flag, not the exit code alone, is the success signal.
- Structured output retries **once** only on schema-validation failure, never on timeout/upstream/auth errors.

`prompts.ts` holds the **`NON_FABRICATION_CONTRACT`** — the single most important product guardrail (use only profile + JD facts, never invent experience). It's centralized for auditability; keep it in one place.

### Errors

Throw the typed `AppError` subclasses in `src/lib/errors.ts` (`BadRequestError`, `ValidationError`, `NotFoundError`, `ConflictError`, `UpstreamError`, `TimeoutError`). The central error middleware uses each error's `expose` flag to decide whether its message reaches the client; `UpstreamError`/`TimeoutError` are logged but hidden behind a generic 5xx. Wrap async route handlers in `asyncHandler`.

### Conventions

ESM throughout (`"type": "module"`): **relative imports must carry the `.js` extension** even from `.ts` sources (e.g. `import { env } from "../config/env.js"`). `src/config/env.ts` exports a frozen, Zod-validated `env`; add new config there, never read `process.env` directly elsewhere.

## Phase 0 scope (what's intentionally absent)

Implemented: data model, profile CRUD + versioning, single-user auth, the Claude CLI generation contract + `/api/generation/health`. **Deferred:** generation feature endpoints, JD extraction, form automation, the tracking dashboard, and all extension UI. `statusMachine.ts` and the `applications`/`artifacts`/`status_events`/`job_descriptions` tables exist as scaffolding for those later phases — don't assume they're wired up.
