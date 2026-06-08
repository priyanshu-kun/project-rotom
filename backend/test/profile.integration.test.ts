import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closeDatabase, pingDatabase, query } from "../src/db/client.js";
import { sha256Hex } from "../src/lib/crypto.js";
import { __resetAuthCache } from "../src/modules/auth/auth.service.js";
import { runMigrations } from "../src/db/migrate.js";

// Probe Postgres at collection time; skip the suite cleanly when it's absent so
// the unit suite still runs in environments without Docker.
let dbAvailable = false;
try {
  await pingDatabase();
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

const TOKEN = "rotom-integration-token-abcdef0123456789";
const app = createApp();
const auth = { Authorization: `Bearer ${TOKEN}` };

const validProfile = {
  personal: {
    fullName: "Grace Hopper",
    email: "grace@example.com",
    phone: "+1 555 0199",
    location: "Arlington, VA",
  },
  professional: {
    skills: ["COBOL", "Compilers"],
    workExperience: [{ company: "US Navy", title: "Rear Admiral" }],
  },
  preferences: { titles: ["Engineer"], workMode: "onsite" },
};

describe.skipIf(!dbAvailable)("Profile API (integration)", () => {
  beforeAll(async () => {
    await runMigrations();
    // Reset to a single user with a known token.
    await query("DELETE FROM users");
    await query("INSERT INTO users (token_hash) VALUES ($1)", [sha256Hex(TOKEN)]);
    __resetAuthCache();
  });

  afterAll(async () => {
    // Leave the isolated test DB clean for the next run.
    await query("DELETE FROM users");
    await closeDatabase();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).get("/api/profile");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns null profile before onboarding", async () => {
    const res = await request(app).get("/api/profile").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeNull();
  });

  it("creates the profile via PUT (version 1)", async () => {
    const res = await request(app).put("/api/profile").set(auth).send(validProfile);
    expect(res.status).toBe(200);
    expect(res.body.profile.version).toBe(1);
    expect(res.body.profile.personal.email).toBe("grace@example.com");
    expect(res.body.profile.professional.education).toEqual([]); // default applied
  });

  it("persists personal PII encrypted at rest", async () => {
    const rows = await query<{ personal: Record<string, unknown> }>(
      "SELECT personal FROM profiles LIMIT 1",
    );
    const personal = rows[0]!.personal;
    // Stored value is an encryption envelope, not plaintext.
    expect(personal).toHaveProperty("v");
    expect(personal).toHaveProperty("iv");
    expect(personal).toHaveProperty("tag");
    expect(personal).toHaveProperty("data");
    expect(JSON.stringify(personal)).not.toContain("grace@example.com");
    expect(JSON.stringify(personal)).not.toContain("Grace Hopper");
  });

  it("bumps version on PATCH and records history", async () => {
    const patch = await request(app)
      .patch("/api/profile")
      .set(auth)
      .send({ preferences: { titles: ["Staff Engineer"], workMode: "remote" } });
    expect(patch.status).toBe(200);
    expect(patch.body.profile.version).toBe(2);
    expect(patch.body.profile.preferences.titles).toEqual(["Staff Engineer"]);
    // PATCH leaves untouched sections intact.
    expect(patch.body.profile.personal.email).toBe("grace@example.com");

    const versions = await request(app).get("/api/profile/versions").set(auth);
    expect(versions.status).toBe(200);
    expect(versions.body.versions).toHaveLength(2);
    expect(versions.body.versions[0].version).toBe(2); // newest first
  });

  it("rejects an invalid payload with 400 + field details", async () => {
    const res = await request(app)
      .put("/api/profile")
      .set(auth)
      .send({ ...validProfile, personal: { ...validProfile.personal, email: "nope" } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details).toBeDefined();
  });
});
