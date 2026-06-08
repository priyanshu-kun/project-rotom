# Project Rotom

AI-assisted job-application Firefox extension + backend. See the PRD for the full
product vision, and [`context/`](./context) for a grounded breakdown of intent vs. the
built state. **This repository implements Phase 0 (Foundations) + Phase 1 (Core Generation MVP).**

## What's built

- **Profile system** — the single source of truth: full CRUD with Zod validation,
  versioning, and append-only history. Personal PII is encrypted at rest. Auth is a
  single-user **API token** (only its SHA-256 hash is stored).
- **JD intake** — create an application from a **URL** (server fetches + strips HTML) or
  **pasted text**; the Claude CLI structures it into fields.
- **Generation** — queued (BullMQ) resume / cover-letter / screening-answer generation,
  grounded in profile + JD with a strict no-fabrication contract; combined "Generate" plus
  per-type regeneration. Per-artifact partial success.
- **Tracking** — auto-recorded applications, list/filter, detail (app + JD + artifacts +
  timeline), and validated status transitions across the 13-state lifecycle.
- **AI layer** — a swappable `GenerationProvider` backed by a sandboxed `claude` subprocess
  (pure text generator, no tools, hard timeout).

Form automation + ATS adapters, the extension UI, match summary, and resume import are
**deferred to later phases** (see [`context/roadmap.md`](./context/roadmap.md)).

## Layout

```
project-rotom/
  docker-compose.yml   # Postgres + Redis for local dev
  backend/             # Node.js + TypeScript service (the focus of Phase 0)
  extension/           # Firefox MV3 scaffold (manifest + API client stub, no UI)
```

## Architecture (HLD)

High-level design of the system as currently built (Phase 0 + Phase 1).

### System context & components

```mermaid
flowchart TB
    subgraph clients["Clients"]
        ext["Firefox MV3 extension<br/>(token API client; no UI yet)"]
        cli["curl / scripts"]
    end

    subgraph backend["Backend — Node.js + TypeScript / Express"]
        direction TB
        mw["Middleware<br/>requestId · helmet · requireAuth · errorHandler"]
        subgraph modules["Feature modules (routes → service → repo)"]
            profile["profile"]
            application["application"]
            artifact["artifact"]
            generation["generation"]
        end
        ai["GenerationProvider<br/>ClaudeCliProvider"]
        worker["BullMQ generation worker"]
        dbc["db/client.ts<br/>pg Pool · query · withTransaction"]
    end

    subgraph infra["Infrastructure / external"]
        pg[("PostgreSQL<br/>:5433")]
        redis[("Redis<br/>:6380")]
        claude["claude CLI<br/>sandboxed subprocess"]
    end

    ext -->|"Bearer token · JSON"| mw
    cli --> mw
    mw --> modules
    application -->|"enqueue job"| redis
    redis --> worker
    worker --> generation
    generation --> ai
    artifact --> ai
    ai -->|"prompt via stdin"| claude
    claude -->|"JSON envelope"| ai
    modules --> dbc
    worker --> dbc
    dbc --> pg
```

### Request layering & generation pipeline

The per-feature path is **routes → service → repo**; encryption and all SQL live
at the repo boundary. Generation is **asynchronous** via a Redis-backed queue.

```mermaid
flowchart LR
    req["HTTP /api/*"] --> auth["requireAuth<br/>constant-time token check"]
    auth --> routes["routes<br/>Zod safeParse"]
    routes --> service["service<br/>re-validate + business logic"]
    service --> repo["repo<br/>raw SQL · encrypt/decrypt"]
    repo --> client["db/client.ts"]
    client --> pg[("PostgreSQL")]

    service -. "POST /:id/generate" .-> enq["enqueueGeneration"]
    enq --> redis[("Redis · BullMQ")]
    redis --> wkr["generation worker"]
    wkr --> gsvc["processGenerationJob"]
    gsvc --> prov["ClaudeCliProvider.generate"]
    prov --> claude["claude subprocess"]
    gsvc --> repo
```

### Data model

Single-user model. Nested sub-entities (work experience, education, JD lists,
artifact content) live in **`jsonb` columns** validated by Zod at the boundary —
a deliberate document model. `job_descriptions` also holds `responsibilities`,
`preferred_skills`, `qualifications`, `keywords`, and `form_fields` (jsonb).

```mermaid
erDiagram
    users ||--o| profiles : has
    users ||--o{ profile_history : versions
    users ||--o{ applications : owns
    applications ||--|| job_descriptions : describes
    applications ||--o{ artifacts : generates
    applications ||--o{ status_events : timeline

    users {
        uuid id PK
        text token_hash "SHA-256 of API token"
        timestamptz created_at
    }
    profiles {
        uuid id PK
        uuid user_id FK "unique"
        jsonb personal "AES-256-GCM at rest"
        jsonb professional
        jsonb preferences
        int version
        timestamptz updated_at
    }
    profile_history {
        uuid id PK
        uuid user_id FK
        int version
        jsonb snapshot "personal stays encrypted"
        timestamptz created_at
    }
    applications {
        uuid id PK
        uuid user_id FK
        text company
        text role
        text job_url
        application_status status "13-state lifecycle"
        timestamptz date_applied
        uuid resume_version_id
        uuid cover_letter_version_id
        text notes
        timestamptz created_at
    }
    job_descriptions {
        uuid id PK
        uuid application_id FK "unique"
        text title
        jsonb required_skills
        jsonb questions
        real extraction_confidence
        timestamptz created_at
    }
    artifacts {
        uuid id PK
        uuid application_id FK
        artifact_type type "resume·cover_letter·answer"
        jsonb content
        int version "immutable once referenced"
        bool edited_by_user
        timestamptz generated_at
    }
    status_events {
        uuid id PK
        uuid application_id FK
        application_status from_status
        application_status to_status
        text note
        timestamptz created_at
    }
```

### Flow: create application → generate → poll

```mermaid
sequenceDiagram
    actor C as Client
    participant API as Express API
    participant DB as PostgreSQL
    participant Q as Redis / BullMQ
    participant W as Generation worker
    participant P as ClaudeCliProvider
    participant CLI as claude subprocess

    C->>API: POST /api/applications {jobUrl | jdText}
    API->>P: extractStructuredJd(text)
    P->>CLI: prompt via stdin
    CLI-->>P: JSON envelope
    API->>DB: createWithJd — app + JD + "Saved" event (tx)
    API-->>C: 201 {application, jobDescription}

    C->>API: POST /api/applications/:id/generate
    API->>Q: enqueueGeneration(job)
    API-->>C: 202 {jobId, status: queued}
    Q->>W: deliver job
    W->>DB: load profile + JD
    W->>P: generate(resume / cover_letter / answers)
    P->>CLI: prompt via stdin
    CLI-->>P: JSON envelope (is_error flag = source of truth)
    W->>DB: insert artifact version + repoint (tx)

    C->>API: GET /api/generation/jobs/:jobId
    API->>Q: getGenerationJob
    Q-->>API: state + result
    API-->>C: completed (artifacts) | partial | failed
```

## Quickstart

```bash
# 1. Infrastructure
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env          # set DATA_ENCRYPTION_KEY (AI layer uses your `claude login`)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # -> DATA_ENCRYPTION_KEY
npm install
npm run migrate               # apply SQL migrations
npm run dev                   # starts on PORT (default 8787); prints the API token once
```

### Try it

```bash
TOKEN="<the token printed on first boot, or your API_TOKEN>"

curl localhost:8787/healthz
curl -H "Authorization: Bearer $TOKEN" localhost:8787/api/profile
curl -H "Authorization: Bearer $TOKEN" localhost:8787/api/generation/health
```

## Scripts (backend)

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server with reload (tsx) |
| `npm run build` / `npm start` | Compile to `dist/` and run with Node |
| `npm run migrate` | Apply pending migrations |
| `npm run test` | Vitest unit + integration tests (uses the isolated `rotom_test` DB) |
| `npm run lint` / `npm run typecheck` | Static checks |

> Postgres is published on host port **5433** and Redis on **6380** (to avoid
> clashing with native services on the default ports). The `.env.example`
> connection strings already match.

## Requirements

- Node.js ≥ 20.10, Docker (for Postgres + Redis)
- The `claude` CLI on `PATH`, logged in via `claude login` (the AI layer reuses
  that subscription token). Optionally set `ANTHROPIC_API_KEY` to override it.
