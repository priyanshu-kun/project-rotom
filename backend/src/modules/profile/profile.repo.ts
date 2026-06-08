import { query, withTransaction } from "../../db/client.js";
import type { ProfileRow } from "../../db/schema.js";
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
  const rows = await query<ProfileRow>(
    `SELECT id,
            user_id      AS "userId",
            personal,
            professional,
            preferences,
            version,
            updated_at   AS "updatedAt"
       FROM profiles
      WHERE user_id = $1
      LIMIT 1`,
    [userId],
  );
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

  return withTransaction(async (client) => {
    // Lock the current row so concurrent upserts serialize on the version bump.
    const existing = await client.query<{ version: number }>(
      `SELECT version FROM profiles WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );

    const nextVersion = existing.rows.length > 0 ? existing.rows[0]!.version + 1 : 1;
    const now = new Date();

    await client.query(
      `INSERT INTO profiles (user_id, personal, professional, preferences, version, updated_at)
            VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
            SET personal     = EXCLUDED.personal,
                professional = EXCLUDED.professional,
                preferences  = EXCLUDED.preferences,
                version      = EXCLUDED.version,
                updated_at   = EXCLUDED.updated_at`,
      [
        userId,
        JSON.stringify(encryptedPersonal),
        JSON.stringify(sections.professional),
        JSON.stringify(sections.preferences),
        nextVersion,
        now,
      ],
    );

    // Snapshot keeps personal encrypted so history never leaks plaintext PII.
    await client.query(
      `INSERT INTO profile_history (user_id, version, snapshot)
            VALUES ($1, $2, $3::jsonb)`,
      [
        userId,
        nextVersion,
        JSON.stringify({
          personal: encryptedPersonal,
          professional: sections.professional,
          preferences: sections.preferences,
          version: nextVersion,
        }),
      ],
    );

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
  return query<ProfileVersionSummary>(
    `SELECT version, created_at AS "createdAt"
       FROM profile_history
      WHERE user_id = $1
      ORDER BY version DESC`,
    [userId],
  );
}
