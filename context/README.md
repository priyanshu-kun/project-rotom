# Project Rotom — Context Folder

This folder is the **single grounding reference** for anyone (human or AI agent) picking up
Project Rotom. It distills the PRD and records the *actual* current state of the codebase so
you don't have to reverse-engineer intent from code.

> **Status as of 2026-06-08:** Phase 0 (Foundations) and Phase 1 (Core Generation MVP) are
> **complete and verified**. The backend can take a job posting (URL or pasted text), structure
> the JD, generate tailored resume/cover-letter/answers via a queued Claude job, and track the
> application lifecycle. **No form automation or extension UI exist yet** (Phase 2).

## Read in this order

| File | What it covers |
|---|---|
| [`product-prd.md`](./product-prd.md) | Distilled PRD: vision, problem, goals/non-goals, personas, the core deterministic-vs-AI split, principles, metrics, NFRs, privacy. |
| [`requirements.md`](./requirements.md) | The functional requirement IDs (PR/JD/GEN/FORM/TRK/LC) with priorities, for traceability. |
| [`architecture.md`](./architecture.md) | Components, layer responsibilities, the Claude CLI boundary, the data model, and the chosen tech stack with rationale. |
| [`current-state.md`](./current-state.md) | **What is actually built today** — endpoints with request/response shapes, file map, verification status, and what is stubbed/deferred. |
| [`decisions.md`](./decisions.md) | Locked decisions (ADR-lite): scope, CLI subprocess, token auth, two-project layout, ports, raw SQL (no ORM), encryption. |
| [`roadmap.md`](./roadmap.md) | Phasing and the concrete next endpoints to build, with what each depends on. |

## The one-paragraph summary

Rotom collapses the repetitive parts of job applications into a supervised pipeline: the user
enters their profile once, then for each posting Rotom analyzes the JD, generates tailored
materials (resume / cover letter / answers), assists form-fill, and tracks the application.
The **core design rule** is a hard boundary: **standard fields are filled deterministically**
(DOM + label matching + ATS adapters, no AI), while **only role-specific free-text content is
AI-generated** (via the Claude Code CLI). The human always reviews and submits — nothing is
fabricated, nothing auto-submits.

## Conventions for keeping this folder accurate

- When you ship a feature, update [`current-state.md`](./current-state.md) in the same change.
- When you make an architectural choice, append an entry to [`decisions.md`](./decisions.md).
- Treat the PRD files (`product-prd.md`, `requirements.md`) as the *intended* product; treat
  `current-state.md` as the *built* product. They will diverge until the product is complete —
  that gap is the work.
