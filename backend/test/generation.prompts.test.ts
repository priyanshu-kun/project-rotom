import { describe, expect, it } from "vitest";
import {
  buildAnswersPrompt,
  buildCoverLetterPrompt,
  buildResumePrompt,
  buildSystemContract,
  type GenerationGrounding,
} from "../src/modules/generation/prompts.js";
import {
  personalSchema,
  preferencesSchema,
  professionalSchema,
} from "../src/modules/profile/profile.schema.js";
import { structuredJdSchema } from "../src/modules/jd/jd.schema.js";

const grounding: GenerationGrounding = {
  personal: personalSchema.parse({ fullName: "Ada Lovelace", email: "ada@example.com" }),
  professional: professionalSchema.parse({
    skills: ["Go", "Algorithms"],
    workExperience: [{ company: "Analytical Engine Co", title: "Programmer" }],
  }),
  preferences: preferencesSchema.parse({ writingStyle: "concise and warm" }),
};

const jd = structuredJdSchema.parse({
  title: "Senior Backend Engineer",
  company: "Acme Corp",
  requiredSkills: ["Go", "Postgres"],
  questions: ["Why do you want to work at Acme?"],
});

describe("buildSystemContract", () => {
  it("includes the non-fabrication contract and JSON-only instruction", () => {
    const contract = buildSystemContract({ jsonOnly: true });
    expect(contract).toContain("TRUTHFULNESS");
    expect(contract.toLowerCase()).toContain("json");
  });
});

describe("prompt builders ground in profile + JD facts", () => {
  it("resume prompt embeds candidate, role, and skills", () => {
    const prompt = buildResumePrompt(grounding, jd);
    expect(prompt).toContain("Ada Lovelace");
    expect(prompt).toContain("Senior Backend Engineer");
    expect(prompt).toContain("Postgres");
    expect(prompt).toContain("ATS-friendly");
  });

  it("cover letter prompt references the company", () => {
    const prompt = buildCoverLetterPrompt(grounding, jd);
    expect(prompt).toContain("Acme Corp");
    expect(prompt).toContain("Analytical Engine Co");
  });

  it("answers prompt uses the JD's questions when present", () => {
    const prompt = buildAnswersPrompt(grounding, jd, jd.questions);
    expect(prompt).toContain("Why do you want to work at Acme?");
  });

  it("answers prompt falls back to default questions when none provided", () => {
    const prompt = buildAnswersPrompt(grounding, jd, []);
    expect(prompt).toContain("Tell us about yourself");
  });

  it("includes user instructions when provided", () => {
    const prompt = buildResumePrompt(grounding, jd, "Emphasize Go experience");
    expect(prompt).toContain("Emphasize Go experience");
  });
});
