import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────
const findByUserId = vi.fn();
const getStructuredJd = vi.fn();
const latestArtifactVersion = vi.fn();
const insertArtifactVersion = vi.fn();
const setApplicationPointer = vi.fn();

vi.mock("../src/modules/profile/profile.repo.js", () => ({ findByUserId }));
vi.mock("../src/modules/application/application.repo.js", () => ({
  getStructuredJd,
  latestArtifactVersion,
  insertArtifactVersion,
  setApplicationPointer,
}));

const { processGenerationJob } = await import("../src/modules/generation/generation.service.js");
const { personalSchema, professionalSchema, preferencesSchema } = await import(
  "../src/modules/profile/profile.schema.js"
);
const { structuredJdSchema } = await import("../src/modules/jd/jd.schema.js");
import type { GenerationProvider, GenerationRequest } from "../src/modules/generation/provider.js";

const storedProfile = {
  personal: personalSchema.parse({ fullName: "Ada", email: "ada@example.com" }),
  professional: professionalSchema.parse({ skills: ["Go"] }),
  preferences: preferencesSchema.parse({}),
  version: 1,
  updatedAt: new Date(),
};

const jd = structuredJdSchema.parse({ title: "Engineer", company: "Acme", questions: ["Why?"] });

/** Provider that returns valid structured output per type, optionally failing one. */
function fakeProvider(options?: { failCoverLetter?: boolean }): GenerationProvider {
  const provider = {
    healthCheck: vi.fn(),
    generate: vi.fn((req: GenerationRequest) => {
      if (req.userPrompt.startsWith("Produce a tailored")) {
        const structured = { summary: "s", highlightedSkills: [], experienceOrder: [], tailoringNotes: [] };
        return Promise.resolve({ text: JSON.stringify(structured), structured, model: "test" });
      }
      if (req.userPrompt.startsWith("Write a personalized")) {
        if (options?.failCoverLetter) {
          return Promise.reject(new Error("cover letter generation failed"));
        }
        const structured = { greeting: "Hi", body: ["p"], closing: "Bye" };
        return Promise.resolve({ text: JSON.stringify(structured), structured, model: "test" });
      }
      const structured = { answers: [{ question: "Why?", answer: "Because." }] };
      return Promise.resolve({ text: JSON.stringify(structured), structured, model: "test" });
    }),
  };
  return provider as unknown as GenerationProvider;
}

beforeEach(() => {
  vi.clearAllMocks();
  findByUserId.mockResolvedValue(storedProfile);
  getStructuredJd.mockResolvedValue(jd);
  latestArtifactVersion.mockResolvedValue(0);
  insertArtifactVersion.mockImplementation((input: { type: string; version: number; applicationId: string }) =>
    Promise.resolve({
      id: `art-${input.type}`,
      applicationId: input.applicationId,
      type: input.type,
      version: input.version,
      editedByUser: false,
      content: {},
      generatedAt: new Date(),
    }),
  );
  setApplicationPointer.mockResolvedValue(undefined);
});

describe("processGenerationJob", () => {
  it("generates all three artifacts and persists each as version 1", async () => {
    const result = await processGenerationJob(
      { userId: "u1", applicationId: "app1", types: ["resume", "cover_letter", "answers"] },
      fakeProvider(),
    );
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(result.partial).toBe(false);
    expect(insertArtifactVersion).toHaveBeenCalledTimes(3);
    expect(result.results[0]).toMatchObject({ type: "resume", version: 1, artifactId: "art-resume" });
  });

  it("reports partial success when one artifact fails (NFR 9.2)", async () => {
    const result = await processGenerationJob(
      { userId: "u1", applicationId: "app1", types: ["resume", "cover_letter", "answers"] },
      fakeProvider({ failCoverLetter: true }),
    );
    expect(result.partial).toBe(true);
    const byType = Object.fromEntries(result.results.map((r) => [r.type, r]));
    expect(byType.resume?.status).toBe("fulfilled");
    expect(byType.answers?.status).toBe("fulfilled");
    expect(byType.cover_letter?.status).toBe("rejected");
    expect(byType.cover_letter?.error).toMatch(/cover letter generation failed/);
    expect(insertArtifactVersion).toHaveBeenCalledTimes(2);
  });

  it("rejects all artifacts when the profile is missing", async () => {
    findByUserId.mockResolvedValue(null);
    const result = await processGenerationJob(
      { userId: "u1", applicationId: "app1", types: ["resume"] },
      fakeProvider(),
    );
    expect(result.results[0]?.status).toBe("rejected");
    expect(result.partial).toBe(false);
    expect(insertArtifactVersion).not.toHaveBeenCalled();
  });
});
