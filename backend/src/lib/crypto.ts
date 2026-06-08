import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, the recommended size for GCM.
const AUTH_TAG_LENGTH = 16;
const ENCRYPTION_VERSION = 1; // Allows future key rotation / algorithm changes.

const key = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");

/**
 * Envelope for an encrypted value. Stored as JSON so the format is
 * self-describing and migratable.
 */
export interface EncryptedEnvelope {
  v: number;
  iv: string; // base64
  tag: string; // base64
  data: string; // base64 ciphertext
}

/**
 * Encrypt an arbitrary JSON-serializable value with AES-256-GCM. Returns a
 * self-describing envelope safe to persist (e.g. in a jsonb column).
 */
export function encryptJson(value: unknown): EncryptedEnvelope {
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: ENCRYPTION_VERSION,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: ciphertext.toString("base64"),
  };
}

function isEnvelope(value: unknown): value is EncryptedEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "v" in value &&
    "iv" in value &&
    "tag" in value &&
    "data" in value
  );
}

/**
 * Decrypt an envelope produced by {@link encryptJson}. Throws if the envelope
 * is malformed, the version is unsupported, or authentication fails (tamper /
 * wrong key).
 */
export function decryptJson<T = unknown>(envelope: unknown): T {
  if (!isEnvelope(envelope)) {
    throw new Error("decryptJson: value is not a valid encrypted envelope");
  }
  if (envelope.v !== ENCRYPTION_VERSION) {
    throw new Error(`decryptJson: unsupported encryption version ${envelope.v}`);
  }

  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.data, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return JSON.parse(plaintext.toString("utf8")) as T;
}

/**
 * SHA-256 hex digest. Used to store the API token as a hash rather than in
 * plaintext.
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two hex digests of equal length. Returns false on
 * length mismatch without leaking timing information about the contents.
 */
export function safeHexEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "hex");
  const bufferB = Buffer.from(b, "hex");
  if (bufferA.length !== bufferB.length || bufferA.length === 0) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/** Generate a new random API token (URL-safe base64, 32 bytes of entropy). */
export function generateApiToken(): string {
  return randomBytes(32).toString("base64url");
}
