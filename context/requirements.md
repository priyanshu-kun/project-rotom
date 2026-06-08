# Functional Requirements (Traceability)

Priorities: **P0** must-have for launch · **P1** should-have · **P2** nice-to-have.
The **Status** column reflects the *built* state (Phase 0). Most are **TODO** by design.

## 7.1 Profile System (PR)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| PR-1 | One-time guided profile setup (personal, professional, preferences) | P0 | API done; guided UI TODO |
| PR-2 | Personal info: name, email, phone, location, website | P0 | ✅ Done |
| PR-3 | Professional: master resume, experience, education, skills, certs, projects, achievements, portfolio, github, linkedin | P0 | ✅ Done |
| PR-4 | Preferences: titles, locations, salary, work mode, writing style | P0 | ✅ Done |
| PR-5 | Profile is the single source of truth for all generation | P0 | ✅ Done (store) |
| PR-6 | Editable any time; edits versioned | P1 | ✅ Done (version + history snapshots) |
| PR-7 | Import master resume from PDF/DOCX → structured fields | P1 | TODO |
| PR-8 | Multiple resume base variants | P2 | TODO |

## 7.2 Job Description Processing (JD)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| JD-1 | Accept a job-posting URL and extract page content | P0 | ✅ Done (`jd.fetch.ts`) |
| JD-2 | Parse into structured fields (title, company, skills, questions, form fields, …) | P0 | ✅ Done (CLI extraction) |
| JD-3 | Persist extracted JD with the application record | P0 | ✅ Done |
| JD-4 | Manual-paste fallback when a URL can't be fetched | P0 | ✅ Done (`jdText`) |
| JD-5 | Confidence flags on low-quality extractions | P1 | ✅ Done (model `extractionConfidence`) |
| JD-6 | Re-extraction / refresh | P2 | TODO |

## 7.3 AI-Powered Generation (GEN)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| GEN-1 | ATS-friendly tailored resume (truthful, reordered, keyworded) | P0 | ✅ Done (queued) |
| GEN-2 | Personalized, human-sounding cover letter (voice-matched) | P0 | ✅ Done (queued) |
| GEN-3 | Screening-question responses | P0 | ✅ Done (queued) |
| GEN-4 | All generation strictly grounded; no invented facts | P0 | ✅ Contract enforced in prompt (`prompts.ts`) |
| GEN-5 | Inline regeneration/refinement with user instructions | P1 | Partial — per-type regenerate w/ instructions + artifact edit |
| GEN-6 | Match summary (covered vs. missing) before generation | P1 | TODO |
| GEN-7 | Voice calibration learned from edits | P2 | TODO |

## 7.4 Form Automation (FORM) — deterministic, no AI

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FORM-1 | Detect application forms via DOM analysis | P0 | TODO (extension) |
| FORM-2 | Map/fill standard fields from profile (label matching) | P0 | TODO (extension) |
| FORM-3 | Insert AI-generated content into free-text fields | P0 | TODO (extension) |
| FORM-4 | Attach generated resume/cover letter to upload fields | P1 | TODO |
| FORM-5 | Highlight filled fields; require review before submit | P0 | TODO |
| FORM-6 | **Never auto-submit** without explicit confirmation | P0 | Design invariant (no submit capability exists) |
| FORM-7 | Graceful handling of unknown fields (blank + flag) | P0 | TODO |
| FORM-8 | ATS adapters (Greenhouse, Lever, Ashby, Workday) + generic fallback | P0 | TODO |

## 7.5 Tracking Dashboard (TRK)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| TRK-1 | Auto-record every application (company, role, URL, status, versions, timeline) | P0 | ✅ Done |
| TRK-2 | List/filter/search by status, company, date | P0 | ✅ Done |
| TRK-3 | Manual status updates with timeline entries | P0 | ✅ Done |
| TRK-4 | Link record → JD + exact artifact versions | P1 | ✅ Done (detail + pointers) |
| TRK-5 | Reminders / follow-up nudges | P2 | TODO |
| TRK-6 | Export history (CSV/JSON) | P2 | TODO |

## 7.6 Lifecycle Management (LC)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| LC-1 | Support the 13 statuses | P0 | ✅ Enum in schema |
| LC-2 | Record every transition with timestamp | P0 | ✅ Done (`status_events` written on each transition) |
| LC-3 | Validated transitions (e.g. block Accepted → Saved) | P1 | ✅ Done (`statusMachine.ts` enforced) |

**The 13 statuses (LC-1):** Saved · Applying · Applied · Under Review · Assessment Received ·
Recruiter Contacted · Interview Scheduled · Technical Interview · Final Interview ·
Offer Received · Rejected · Accepted · Withdrawn.
