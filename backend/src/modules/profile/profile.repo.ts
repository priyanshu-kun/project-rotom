import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { profileHistory, profiles } from "../../db/schema.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import type { Personal, Preferences, Professional } from "./profile.schema.js";

/** Decrypted profile as stored, plus version metadata. */
export interface StoredProfile {
  personal: Personal;
  professional: Professional;
  preferences: Preferences;
  version: number;
  updatedAt: Date;
}

export interface ProfileSections {
  personal: Personal;
  professional: Professional;
  preferences: Preferences;
}

export interface ProfileVersionSummary {
  version: number;
  createdAt: Date;
}

function decryptPersonal(value: unknown): Personal {
  return decryptJson<Personal>(value);
}

/** Fetch the user's current profile with `personal` transparently decrypted. */
export async function findByUserId(userId: string): Promise<StoredProfile | null> {
  const rows = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    personal: decryptPersonal(row.personal),
    professional: row.professional as Professional,
    preferences: row.preferences as Preferences,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/**
 * Atomically upsert the full profile and append an immutable history snapshot,
 * bumping the version. `personal` is encrypted before persistence (both in the
 * live row and the snapshot). Runs in a single transaction so the row and its
 * snapshot can never diverge.
 */
export async function upsertWithHistory(
  userId: string,
  sections: ProfileSections,
): Promise<StoredProfile> {
  const encryptedPersonal = encryptJson(sections.personal);

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ version: profiles.version })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .for("update")
      .limit(1);

    const nextVersion = existing.length > 0 ? existing[0]!.version + 1 : 1;
    const now = new Date();

    const values = {
      userId,
      personal: encryptedPersonal,
      professional: sections.professional,
      preferences: sections.preferences,
      version: nextVersion,
      updatedAt: now,
    };

    await tx
      .insert(profiles)
      .values(values)
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          personal: values.personal,
          professional: values.professional,
          preferences: values.preferences,
          version: values.version,
          updatedAt: values.updatedAt,
        },
      });

    // Snapshot keeps personal encrypted so history never leaks plaintext PII.
    await tx.insert(profileHistory).values({
      userId,
      version: nextVersion,
      snapshot: {
        personal: encryptedPersonal,
        professional: sections.professional,
        preferences: sections.preferences,
        version: nextVersion,
      },
    });

    return {
      personal: sections.personal,
      professional: sections.professional,
      preferences: sections.preferences,
      version: nextVersion,
      updatedAt: now,
    };
  });
}

/** List version history (newest first), without decrypting snapshots. */
export async function listVersions(userId: string): Promise<ProfileVersionSummary[]> {
  const rows = await db
    .select({ version: profileHistory.version, createdAt: profileHistory.createdAt })
    .from(profileHistory)
    .where(eq(profileHistory.userId, userId))
    .orderBy(desc(profileHistory.version));
  return rows;
}
