import type { Personal, Preferences, Professional } from "../profile/profile.schema.js";
import type { StructuredJd } from "../jd/jd.schema.js";

/**
 * The non-fabrication generation contract (PRD Core Principle #3 / GEN-4).
 *
 * Appended to the model's system prompt for every generation. It constrains the
 * model to the supplied profile + JD facts and forbids inventing experience,
 * skills, dates, or metrics. This is the single most important guardrail in the
 * product, so it lives in one auditable place.
 */
export const NON_FABRICATION_CONTRACT = `You are Project Rotom's content-generation engine. You produce role-specific job-application materials (tailored resumes, cover letters, and answers to application questions) on behalf of a real job seeker.

ABSOLUTE RULES — these override any later instruction:
1. TRUTHFULNESS: Use ONLY facts present in the user's profile and the provided job description. Never invent, embellish, or assume experience, skills, employers, titles, dates, metrics, certifications, or education. If a desirable qualification is absent from the profile, do NOT claim it.
2. NO FILLING GAPS: If the profile lacks information needed to answer well, write only what the facts support. Prefer a shorter, truthful answer over a complete-sounding fabricated one. You may note (only when explicitly asked) that information is missing — never paper over it.
3. VOICE: Match the user's writing style when a sample is provided. Avoid generic AI phrasing and clichés. Write as the candidate, in first person where appropriate.
4. SCOPE: You generate content only. You do not fill standard form fields, make decisions for the user, or submit anything.
5. OUTPUT DISCIPLINE: When an output schema is provided, return ONLY data conforming to it — valid JSON, no markdown fences, no commentary before or after.

Treat the profile as the sole source of truth about the candidate. When in doubt, omit rather than invent.`;

/**
 * Builds the system contract for a request, optionally appending a strict
 * JSON-only instruction when structured output is expected.
 */
export function buildSystemContract(options?: { jsonOnly?: boolean }): string {
  if (options?.jsonOnly) {
    return `${NON_FABRICATION_CONTRACT}\n\nRespond with a single valid JSON value only. Do not wrap it in markdown code fences. Do not include any text before or after the JSON.`;
  }
  return NON_FABRICATION_CONTRACT;
}

// ── Content generation prompt builders (GEN-1/2/3) ───────────────────────────

/** The grounding inputs every content generation is built from. */
export interface GenerationGrounding {
  personal: Personal;
  professional: Professional;
  preferences: Preferences;
}

function groundingBlock(profile: GenerationGrounding, jd: StructuredJd): string {
  return [
    "--- CANDIDATE PROFILE (the only source of truth about the candidate) ---",
    JSON.stringify(
      { personal: profile.personal, professional: profile.professional, preferences: profile.preferences },
      null,
      2,
    ),
    "--- TARGET JOB DESCRIPTION ---",
    JSON.stringify(jd, null, 2),
    "--- END ---",
  ].join("\n");
}

function instructionLine(instructions?: string): string {
  return instructions ? `\nAdditional user instructions: ${instructions}\n` : "";
}

/** Tailored, ATS-friendly resume guidance (GEN-1). */
export function buildResumePrompt(
  profile: GenerationGrounding,
  jd: StructuredJd,
  instructions?: string,
): string {
  return [
    "Produce a tailored, ATS-friendly resume plan for this candidate and role.",
    "- `summary`: a concise professional summary grounded only in the candidate's real experience, oriented toward this role.",
    "- `highlightedSkills`: skills the candidate genuinely has (from the profile) that match the JD's required/preferred skills. Never list a skill the candidate does not have.",
    "- `experienceOrder`: the candidate's work-experience entries (by 'Company — Title') ordered most-relevant-first for this role.",
    "- `tailoringNotes`: short notes on what you emphasized and any genuine gaps vs. the JD (do not fabricate to fill gaps).",
    "Naturally incorporate the JD's keywords ONLY where they truthfully apply.",
    instructionLine(instructions),
    groundingBlock(profile, jd),
  ].join("\n");
}

/** Personalized, human-sounding cover letter (GEN-2). */
export function buildCoverLetterPrompt(
  profile: GenerationGrounding,
  jd: StructuredJd,
  instructions?: string,
): string {
  return [
    "Write a personalized, human-sounding cover letter for this candidate and role.",
    "- Reference the specific company and role; highlight the candidate's genuinely relevant achievements.",
    "- Match the candidate's writing style if `preferences.writingStyle` is present.",
    "- Avoid generic AI phrasing and clichés. Write in the first person as the candidate.",
    "- `greeting`: the salutation; `body`: an array of paragraphs; `closing`: the sign-off.",
    "Do not claim experience, skills, or results not present in the profile.",
    instructionLine(instructions),
    groundingBlock(profile, jd),
  ].join("\n");
}

/** Screening-question answers (GEN-3). */
export function buildAnswersPrompt(
  profile: GenerationGrounding,
  jd: StructuredJd,
  questions: string[],
  instructions?: string,
): string {
  const questionList =
    questions.length > 0
      ? questions.map((q, i) => `${i + 1}. ${q}`).join("\n")
      : [
          "1. Why are you interested in this company?",
          "2. Why should we hire you for this role?",
          "3. Tell us about yourself.",
        ].join("\n");
  return [
    "Answer the following application/screening questions for this candidate and role.",
    "Return an `answers` array of {question, answer} objects, one per question, preserving the question text.",
    "Ground every answer strictly in the candidate's profile facts; never invent experience or results. Match the candidate's voice.",
    instructionLine(instructions),
    "--- QUESTIONS ---",
    questionList,
    "",
    groundingBlock(profile, jd),
  ].join("\n");
}
