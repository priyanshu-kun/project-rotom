# Product Context (Distilled PRD)

> Source: Project Rotom PRD, Draft v0.1 (2026-06-05). This is a faithful distillation, not a
> replacement — it captures intent and the non-negotiables. Type: Firefox WebExtension +
> backend service.

## 1. The problem

Job seekers repeat the same low-leverage tasks on every application: read the JD, re-tailor a
resume, write a cover letter, answer near-identical screening questions, fill forms by hand,
and track status across dozens of postings. It's repetitive, error-prone, and forces a
trade-off between **volume** and **quality**. Existing tools are either "spray-and-pray"
auto-appliers that fabricate/genericize (and damage credibility) or standalone resume builders
that never touch the live application surface. Neither closes the loop
*job posting → tailored materials → assisted submission → tracked outcome* while keeping the
human in control.

## 2. The solution & its core design decision

Rotom pairs **two distinct mechanisms with a hard boundary between them**:

- **Deterministic browser form automation** for **standard fields** (personal, contact,
  education, work experience, skills, document uploads). Filled via DOM analysis, field-label
  matching, and ATS-specific adapters (Greenhouse, Lever, Ashby, Workday) with a generic
  fallback. **No AI is involved in mapping these** — a name field is filled from the profile's
  name, never from a model's guess.
- **Claude Code CLI** for **role-specific content only** (tailored resumes, cover letters,
  free-text screening answers), grounded in the user's profile + the target JD.

The CLI **never** maps/fills standard fields, **never** submits, and **never** makes the final
decision. This separation is the product's spine: deterministic filling is predictable and
auditable; AI is reserved for the parts that genuinely require tailoring.

Two entry points: (1) user provides a job-posting URL, or (2) activates the extension on a job
page. Target outcome: cut active time-to-submit a high-quality, **truthful**, role-specific
application from **30–60 min to under 2 min**.

## 3. Goals

- < 2 min of active user time per tailored application.
- **Strict truthfulness** — no fabricated experience, skills, or credentials, ever.
- Human-quality, **ATS-friendly** materials that match the user's voice.
- User is the **final decision-maker** on every artifact and every submission.
- A single source-of-truth profile + complete, queryable application history.
- Privacy-first and transparent about what the extension reads and does.

## 4. Non-goals (explicitly out of scope — not "later phases")

Automatic job discovery/aggregation · interview scheduling · salary-negotiation automation ·
recruiter outreach · mobile clients · multi-user/team/agency accounts · fully autonomous
submission with no human review · browsers other than Firefox (Chrome/Edge are uncommitted
future candidates).

## 5. Personas

- **Priya** — high-volume targeted applicant (15–30 roles). Wants tailoring without the grind;
  cares about ATS keyword coverage and not sounding like a bot.
- **Sam** — selective senior candidate. Uses Rotom mostly for cover letter + answers, heavily
  edits, values voice-matching and factual control.
- **Dev** — early-career. Relies on Rotom for structure and first drafts.

All three share one hard requirement: the application must be **honest** and read as **theirs**.

## 6. Core principles (non-negotiable)

1. Enter your information once.
2. Every application is customized to the role.
3. **No fabricated experience or skills — ever.**
4. Output reads as human-written and matches the user's voice.
5. Materials are ATS-friendly.
6. The user retains final control over content and submission.
7. Privacy-first by design.
8. Automation is transparent and supervised, never silent.

## 7. Success metrics (90 days post-launch)

| Metric | Target |
|---|---|
| Median active time-to-submit | < 120s |
| Material acceptance rate (submitted with no/minor edits) | ≥ 60% |
| Applications per active user / week | ≥ 10 |
| Form-fill accuracy (detected fields correctly mapped) | ≥ 90% |
| Tracking completeness (apps with a recorded final status) | ≥ 70% |
| D30 retention | ≥ 35% |
| **Truthfulness incidents (fabrications)** | **0 — hard requirement; any non-zero triggers investigation** |

## 8. Non-functional requirements (targets)

- **Performance:** JD extraction P50<5s/P95<12s · full generation P50<30s/P95<60s · form
  detection+fill <2s · dashboard list <1s for 1,000 records.
- **Reliability:** generation failures retryable, never corrupt the saved record; partial
  generation surfaces per-artifact status, not a whole-batch failure.
- **Compatibility:** Firefox stable + ESR (current and previous major), resilient to SPA pages.
- **Accessibility:** WCAG 2.1 AA for extension UI.

## 9. Privacy, security & compliance

Handles sensitive PII and acts on third-party sites, so privacy is first-class:
data minimization · scoped page access (content scripts only on user invocation, only on the
active page) · **encryption at rest and in transit** · transparent disclosure + activity log ·
full export and hard-delete · explicit no-fabrication guardrail in generation prompts ·
**no silent automation** (submission always requires explicit user action).

**Open compliance question:** automated form-fill/extraction may interact with individual ATS
Terms of Service and bot-detection — needs legal review before GA. The mitigation posture is
"assist, don't autopilot; never auto-submit."
