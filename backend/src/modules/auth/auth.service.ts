import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";
import { query } from "../../db/client.js";
import type { UserRow } from "../../db/schema.js";
import { env } from "../../config/env.js";
import { generateApiToken, safeHexEqual, sha256Hex } from "../../lib/crypto.js";
import { logger } from "../../lib/logger.js";

const TOKEN_FILE = path.resolve(process.cwd(), ".rotom-token");

export type TokenSource = "env" | "file" | "generated";

interface ResolvedToken {
  token: string;
  source: TokenSource;
}

/**
 * Determine the API token for this deployment, in priority order:
 *   1. `API_TOKEN` env var (operator-managed).
 *   2. A previously persisted `.rotom-token` file.
 *   3. A freshly generated token, persisted to `.rotom-token` (0600).
 */
function resolveApiToken(): ResolvedToken {
  if (env.API_TOKEN) {
    return { token: env.API_TOKEN, source: "env" };
  }
  if (existsSync(TOKEN_FILE)) {
    const fromFile = readFileSync(TOKEN_FILE, "utf8").trim();
    if (fromFile.length >= 16) {
      return { token: fromFile, source: "file" };
    }
  }
  const token = generateApiToken();
  writeFileSync(TOKEN_FILE, token, { encoding: "utf8", mode: 0o600 });
  // Tighten perms even if the file pre-existed with a looser mode.
  chmodSync(TOKEN_FILE, 0o600);
  return { token, source: "generated" };
}

// In-memory cache of the single user's id + token hash. Populated at boot; the
// single-user model means this never changes during a process lifetime.
let cachedUser: { id: string; tokenHash: string } | null = null;

/**
 * Idempotently ensure exactly one user row exists whose `token_hash` matches the
 * resolved API token. Returns the user and how the token was sourced. Called
 * once during startup (and by the seed CLI).
 */
export async function bootstrapAuth(): Promise<{ user: UserRow; source: TokenSource }> {
  const { token, source } = resolveApiToken();
  const tokenHash = sha256Hex(token);

  const existing = await query<UserRow>(
    `SELECT id, token_hash AS "tokenHash", created_at AS "createdAt" FROM users LIMIT 1`,
  );
  let user: UserRow;

  if (existing.length === 0) {
    const inserted = await query<UserRow>(
      `INSERT INTO users (token_hash) VALUES ($1)
         RETURNING id, token_hash AS "tokenHash", created_at AS "createdAt"`,
      [tokenHash],
    );
    user = inserted[0]!;
  } else {
    user = existing[0]!;
    // Keep the stored hash in sync if the operator rotated API_TOKEN.
    if (user.tokenHash !== tokenHash) {
      const updated = await query<UserRow>(
        `UPDATE users SET token_hash = $1 WHERE id = $2
           RETURNING id, token_hash AS "tokenHash", created_at AS "createdAt"`,
        [tokenHash, user.id],
      );
      user = updated[0]!;
    }
  }

  cachedUser = { id: user.id, tokenHash };

  if (source === "generated") {
    logger.warn(
      { tokenFile: TOKEN_FILE },
      `Generated a new API token. Use it as 'Authorization: Bearer <token>'.\n` +
        `    Token: ${token}\n` +
        `    (also written to ${TOKEN_FILE}; set API_TOKEN to manage it explicitly)`,
    );
  } else {
    logger.info({ source }, "API token loaded");
  }

  return { user, source };
}

/**
 * Verify a presented bearer token against the single user's stored hash using a
 * constant-time comparison. Returns the user id on success, or null otherwise.
 * Lazily loads the cache if the process skipped `bootstrapAuth` (e.g. tests).
 */
export async function verifyToken(presentedToken: string): Promise<{ userId: string } | null> {
  if (!presentedToken) {
    return null;
  }
  if (!cachedUser) {
    const rows = await query<Pick<UserRow, "id" | "tokenHash">>(
      `SELECT id, token_hash AS "tokenHash" FROM users LIMIT 1`,
    );
    if (rows.length === 0) {
      return null;
    }
    cachedUser = { id: rows[0]!.id, tokenHash: rows[0]!.tokenHash };
  }

  const presentedHash = sha256Hex(presentedToken);
  if (!safeHexEqual(presentedHash, cachedUser.tokenHash)) {
    return null;
  }
  return { userId: cachedUser.id };
}

/** Test-only hook to reset the in-memory cache. */
export function __resetAuthCache(): void {
  cachedUser = null;
}
