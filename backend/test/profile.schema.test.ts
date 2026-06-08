import { describe, expect, it } from "vitest";
import {
  preferencesSchema,
  professionalSchema,
  profileInputSchema,
  profilePatchSchema,
} from "../src/modules/profile/profile.schema.js";

const validInput = {
  personal: {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+1 555 0100",
    location: "London, UK",
    website: "https://ada.example.com",
  },
  professional: {
    masterResume: "Pioneering programmer.",
    workExperience: [
      { company: "Analytical Engine Co", title: "Programmer", highlights: ["Wrote first algorithm"] },
    ],
    skills: ["Mathematics", "Algorithms"],
  },
  preferences: {
    titles: ["Software Engineer"],
    workMode: "remote",
  },
};

describe("profileInputSchema", () => {
  it("accepts a valid profile and applies array defaults", () => {
    const parsed = profileInputSchema.parse(validInput);
    expect(parsed.professional.education).toEqual([]);
    expect(parsed.professional.certifications).toEqual([]);
    expect(parsed.preferences.locations).toEqual([]);
  });

  it("requires full name and a valid email", () => {
    expect(() =>
      profileInputSchema.parse({
        ...validInput,
        personal: { ...validInput.personal, fullName: "" },
      }),
    ).toThrow();
    expect(() =>
      profileInputSchema.parse({
        ...validInput,
        personal: { ...validInput.personal, email: "not-an-email" },
      }),
    ).toThrow();
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(() => profileInputSchema.parse({ ...validInput, hacker: true })).toThrow();
  });

  it("coerces an empty website to undefined", () => {
    const parsed = profileInputSchema.parse({
      ...validInput,
      personal: { ...validInput.personal, website: "" },
    });
    expect(parsed.personal.website).toBeUndefined();
  });
});

describe("professionalSchema", () => {
  it("rejects an invalid portfolio URL", () => {
    expect(() => professionalSchema.parse({ portfolioLinks: ["not a url"] })).toThrow();
  });
});

describe("preferencesSchema", () => {
  it("rejects an invalid work mode", () => {
    expect(() => preferencesSchema.parse({ workMode: "underwater" })).toThrow();
  });
});

describe("profilePatchSchema", () => {
  it("accepts a single section", () => {
    const parsed = profilePatchSchema.parse({ preferences: { titles: ["SRE"] } });
    expect(parsed.preferences?.titles).toEqual(["SRE"]);
  });

  it("rejects an empty patch", () => {
    expect(() => profilePatchSchema.parse({})).toThrow(/At least one/);
  });
});
