# Roadmap

PRD phasing, plus the concrete next endpoints and what each depends on. Phase 0 is done; the
rest is the gap between the *built* product (`current-state.md`) and the *intended* product
(`product-prd.md`).

## Phase plan (PRD §15)

- **Phase 0 — Foundations** ✅ **DONE.** Profile system, data model, auth, backend skeleton, CLI
  integration contract.
- **Phase 1 — Core generation (MVP).** ✅ **DONE.** JD intake (URL fetch + paste, JD-1…JD-4),
  queued resume/cover-letter/answer generation (GEN-1…GEN-4), tracking (TRK-1/2/3/4, LC-1/2/3),
  immutability-preserving artifact edits. The full "paste/fetch → tailored materials → tracked
  record" loop now exists in the backend.
- **Phase 2 — Form automation (deterministic).** ← **NEXT** DOM detection + label-matched fill + review
  gates (FORM-1…FORM-7), ATS adapters Greenhouse/Lever/Ashby/Workday + generic fallback
  (FORM-8), document attach (FORM-4). All deterministic; AI content inserted into free-text only.
- **Phase 3 — Polish & depth.** Match summary (GEN-6), inline regeneration (GEN-5), resume
  import/parse (PR-7), dashboard search/filter/export (TRK-2, TRK-6), reminders (TRK-5).
- **Phase 4 — Post-v1.** Voice calibration (GEN-7), multiple base resumes (PR-8), Chrome/Edge,
  more ATS adapters.

## Phase 1 — shipped

All Phase 1 backend endpoints exist (see `current-state.md`): applications/JD intake, queued
generation (combined + per-type regenerate), tracking (list/detail/status), and artifact edits.
BullMQ queue + in-process worker are wired on the existing Redis.

## Next: Phase 2 — deterministic form automation + first extension UI

The backend can now produce and track tailored materials, but a user still can't *use* it — the
extension is a scaffold. The natural next slice is the **extension** (apply popup + dashboard +
content scripts) consuming the existing API, and **deterministic form automation** (FORM-1…FORM-8).

| Area | To build | Builds on (already present) |
|---|---|---|
| **Extension apply flow** | Popup: paste/confirm JD → trigger generate → poll job → review/edit artifacts | the full `/api/applications` + `/api/generation/jobs` API |
| **Extension dashboard** | List/detail/status UI | `GET /api/applications`, `PATCH .../status` |
| **Form automation** | Content-script DOM detection + label-matched fill + review gates (FORM-1…7) | the structured profile (deterministic, no AI) |
| **ATS adapters** | Greenhouse/Lever/Ashby/Workday + generic fallback (FORM-8) | per-site DOM adapters |
| **Match summary** | `POST /api/applications/:id/match` (GEN-6) | profile + structured JD |
| **Profile import** | `POST /api/profile/import` (PDF/DOCX → structured, PR-7) | profile schemas; a parser |

## Cross-cutting still owed (backend)

- **Activity log** of generations + fills (PRD transparency requirement).
- Optional: split the BullMQ worker into its own process; add job retry/backoff policy.
- Optional: surface low `extractionConfidence` as a client warning (JD-5 is captured but not yet flagged in UI).

## Known open questions (PRD §14) to resolve before GA

1. Legal posture on automated form-fill across ATS ToS; does "assist-only, no auto-submit"
   sufficiently de-risk it?
2. Exact data-flow disclosure users see (where generation runs relative to user data).
3. Reliable master-resume parsing across heterogeneous PDF/DOCX layouts.
4. Conflict-resolution model when a JD form field has no profile counterpart.
5. How "voice matching" is sourced — explicit style sample, learned from edits, or both.
