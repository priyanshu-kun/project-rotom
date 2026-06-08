import { NotFoundError } from "../../lib/errors.js";
import {
  findByUserId,
  listVersions,
  upsertWithHistory,
  type ProfileVersionSummary,
  type StoredProfile,
} from "./profile.repo.js";
import {
  profileInputSchema,
  profilePatchSchema,
  type Profile,
  type ProfileInput,
  type ProfilePatch,
} from "./profile.schema.js";

function toProfile(stored: StoredProfile): Profile {
  return {
    personal: stored.personal,
    professional: stored.professional,
    preferences: stored.preferences,
    version: stored.version,
    updatedAt: stored.updatedAt.toISOString(),
  };
}

/** Fetch the current profile, or throw 404 if onboarding hasn't run yet. */
export async function getProfile(userId: string): Promise<Profile> {
  const stored = await findByUserId(userId);
  if (!stored) {
    throw new NotFoundError("Profile has not been created yet");
  }
  return toProfile(stored);
}

export async function getProfileOrNull(userId: string): Promise<Profile | null> {
  const stored = await findByUserId(userId);
  return stored ? toProfile(stored) : null;
}

/**
 * Replace the entire profile (PUT). Input is re-validated here so the service
 * is safe to call from non-HTTP contexts too. Bumps version + snapshots.
 */
export async function replaceProfile(userId: string, input: ProfileInput): Promise<Profile> {
  const validated = profileInputSchema.parse(input);
  const stored = await upsertWithHistory(userId, validated);
  return toProfile(stored);
}

/**
 * Partially update one or more sections (PATCH). Requires an existing profile;
 * each provided section fully replaces the prior section (it is not deep-merged
 * field-by-field, since arrays like skills/experience are wholesale edits).
 */
export async function patchProfile(userId: string, patch: ProfilePatch): Promise<Profile> {
  const validated = profilePatchSchema.parse(patch);
  const current = await findByUserId(userId);
  if (!current) {
    throw new NotFoundError("Cannot patch a profile that does not exist; create it first");
  }

  const merged = {
    personal: validated.personal ?? current.personal,
    professional: validated.professional ?? current.professional,
    preferences: validated.preferences ?? current.preferences,
  };

  const stored = await upsertWithHistory(userId, merged);
  return toProfile(stored);
}

export async function getProfileVersions(userId: string): Promise<ProfileVersionSummary[]> {
  return listVersions(userId);
}
