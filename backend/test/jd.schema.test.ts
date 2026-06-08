import { describe, expect, it } from "vitest";
import { structuredJdSchema } from "../src/modules/jd/jd.schema.js";

describe("structuredJdSchema", () => {
  it("applies defaults for a sparse posting", () => {
    const parsed = structuredJdSchema.parse({});
    expect(parsed.title).toBeNull();
    expect(parsed.responsibilities).toEqual([]);
    expect(parsed.requiredSkills).toEqual([]);
    expect(parsed.questions).toEqual([]);
    expect(parsed.extractionConfidence).toBe(0);
  });

  it("accepts a full posting", () => {
    const parsed = structuredJdSchema.parse({
      title: "Backend Engineer",
      company: "Acme",
      location: "Remote",
      requiredSkills: ["Go", "Postgres"],
      questions: ["Why us?"],
      extractionConfidence: 0.9,
    });
    expect(parsed.title).toBe("Backend Engineer");
    expect(parsed.requiredSkills).toEqual(["Go", "Postgres"]);
    expect(parsed.extractionConfidence).toBe(0.9);
  });

  it("rejects out-of-range confidence", () => {
    expect(() => structuredJdSchema.parse({ extractionConfidence: 1.5 })).toThrow();
  });

  it("rejects unknown keys (strict)", () => {
    expect(() => structuredJdSchema.parse({ hacker: true })).toThrow();
  });
});
