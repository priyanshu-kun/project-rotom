# Architecture

## Components (PRD §10)

```
┌─────────────────────────────────────────────────────────┐
│  Firefox WebExtension (React + TypeScript)               │   ← Phase 0: scaffold only (no UI)
│   Popup UI · Dashboard UI · Content Scripts              │
│              └── Background Service Worker ──┘            │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTPS (Bearer API token)
┌───────────────────────────▼─────────────────────────────┐
│  Backend (Node.js + TypeScript)                          │   ← Phase 0: built
│   API gateway · Auth · Profile svc · Application svc     │
│   Generation orchestrator ──► Claude Code CLI (AI layer) │
│   PostgreSQL (durable state) · Redis (cache/queue)       │
└──────────────────────────────────────────────────────────┘
```

## Layer responsibilities

- **Extension (frontend):** UI, in-page JD extraction, **deterministic** form detection &
  field-fill (DOM + label matching + ATS adapters), insertion of *approved* AI content, and the
  human-in-the-loop gates (review, confirm). **Form-mapping logic lives here and uses no AI.**
  *(Phase 0: only a manifest + token-authenticated API client + a connectivity-ping background
  stub exist.)*
- **Backend:** orchestration, persistence, auth, generation job management. The CLI is invoked
  server-side, never from the browser.
- **AI layer (Claude Code CLI):** JD analysis + generation of **role-specific content only**
  (resume, cover letter, free-text answers). **Not** involved in mapping/filling standard
  fields, has **no submit capability**, never the actor that clicks "Apply."
- **Storage:** PostgreSQL for durable entities; Redis for caching extracted JDs, the generation
  job queue, and rate-limit/session state.

## The Claude Code CLI boundary (PRD §10.3)

Every generation request is grounded in (a) the structured profile and (b) the structured JD.
The prompt contract forbids fabrication and instructs fact-grounding only. Outputs are returned
as structured artifacts (resume sections, cover letter, Q/A pairs) for the frontend to render
and the user to edit. **The CLI maps/fills nothing, submits nothing, decides nothing.**

In code this is a swappable interface so the engine can be replaced without touching callers:

```
GenerationProvider (interface)              backend/src/modules/generation/provider.ts
  └── ClaudeCliProvider (subprocess impl)   backend/src/modules/generation/claudeCli.provider.ts
```

`ClaudeCliProvider` runs `claude` as a **sandboxed, non-interactive, pure-text generator**:
- args passed as an array (no shell → no injection); **prompt piped via stdin** (not argv);
- `--tools ""` disables every tool (cannot read files or run commands);
- `--no-session-persistence` (nothing written to disk) + `--strict-mcp-config` (no MCP servers
  loaded) + `--system-prompt` full-replace (suppresses user CLAUDE.md / auto-memory injection);
- runs in a throwaway temp `cwd`; minimal env (`PATH`/`HOME`/`CI`). Auth uses the logged-in
  `claude` subscription token (found via `HOME`); `ANTHROPIC_API_KEY` is an optional override.
  `--bare` is **not** used — it forces API-key auth and never reads the subscription login;
- hard **SIGKILL timeout**; the JSON envelope's `is_error` flag — not just the exit code — is
  the source of truth for success;
- structured output via `--json-schema` **and** post-validation against a Zod schema, with one
  retry on parse/validation failure.

## Data model (PRD §11)

```
users            id, token_hash, created_at
profiles (1:1)   user_id, personal(jsonb, ENCRYPTED), professional(jsonb), preferences(jsonb), version, updated_at
profile_history  user_id, version, snapshot(jsonb), created_at        ← append-only versioning
applications     id, user_id, company, role, job_url, status(enum), date_applied,
                 resume_version_id, cover_letter_version_id, notes, created_at
job_descriptions application_id(1:1), title, company, location, responsibilities[], required_skills[],
(1:1 application)preferred_skills[], qualifications[], keywords[], questions[], form_fields[], extraction_confidence
artifacts        id, application_id, type(enum resume|cover_letter|answer), content(jsonb),
                 version, edited_by_user, generated_at
status_events    id, application_id, from_status, to_status, note, created_at  ← timeline
```

**Key constraints:** all FKs `ON DELETE CASCADE` from `users` down (right-to-delete);
`applications.status` defaults to `Saved`; artifact versions are immutable once referenced
(enforced in the service layer — new edits create a new version row); status transitions are
validated against the allowed-transition state machine.

**Modeling choice:** nested profile sub-entities (work experience, education, …) live inside
`jsonb` columns validated by Zod at the boundary — a deliberate document model that avoids
premature normalization for a single-user product.

## Tech stack (chosen where the PRD left it open)

| Concern | Choice | Why |
|---|---|---|
| Runtime/lang | Node.js ≥20, TypeScript (strict, ESM, NodeNext) | PRD-specified |
| HTTP | Express 4 + `helmet` | Ubiquitous, reviewable; async errors wrapped via `asyncHandler` |
| Validation | Zod at every boundary | Single source for the data contract; inferred TS types |
| DB access | Raw parameterized SQL over `node-postgres` (no ORM) | Explicit hand-written SQL via `query`/`withTransaction`; numbered `migrations/*.sql` applied by a custom tracked runner |
| Cache/queue | `ioredis` (BullMQ deferred to Phase 1) | Wired + health-checked now |
| Logging | `pino` with PII/secret redaction | Structured logs; never leaks personal data or tokens |
| Tests | Vitest + supertest | Unit + DB-backed integration |
| AI layer | **Claude Code CLI subprocess** | PRD-specified; behind the swappable `GenerationProvider` |
| Auth | **Single-user API token** | Per project decision; no login UI for v1 |
| Repo layout | **Two separate projects** (`backend/`, `extension/`) | Per project decision |
```
