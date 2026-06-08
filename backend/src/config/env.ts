import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Load .env into process.env before validation. In production the platform is
// expected to inject real environment variables; dotenv is a no-op then.
loadDotenv();

/**
 * Base64-encoded 32-byte key check. AES-256-GCM requires exactly 32 bytes.
 */
const encryptionKeySchema = z
  .string()
  .min(1, "DATA_ENCRYPTION_KEY is required")
  .refine(
    (value) => {
      try {
        return Buffer.from(value, "base64").length === 32;
      } catch {
        return false;
      }
    },
    'DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key (generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))")',
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  PORT: z.coerce.number().int().positive().max(65535).default(8787),

  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection URL"),
  REDIS_URL: z.string().url("REDIS_URL must be a valid connection URL"),

  // Optional: generated on first boot when absent. A blank value in .env (empty
  // string) is treated as "unset" so operators can leave the line in place.
  API_TOKEN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(16).optional(),
  ),
  DATA_ENCRYPTION_KEY: encryptionKeySchema,

  // Optional override for the AI layer. When unset (the default), generation
  // authenticates with the already-logged-in `claude` subscription token in
  // ~/.claude/.credentials.json. When set, it is forwarded to the CLI and the
  // CLI prefers it over the subscription login. A blank value is treated as
  // unset so operators can leave the line in place.
  ANTHROPIC_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  CLAUDE_BIN: z.string().min(1).default("claude"),
  CLAUDE_MODEL: z.string().min(1).default("claude-opus-4-8"),
  CLAUDE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  CLAUDE_MAX_BUDGET_USD: z.coerce.number().positive().default(1.0),

  // Generation queue (BullMQ on Redis).
  GENERATION_CONCURRENCY: z.coerce.number().int().positive().max(50).default(3),
  QUEUE_PREFIX: z.string().min(1).default("rotom"),

  // Server-side job-description URL fetching.
  JD_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  JD_FETCH_MAX_BYTES: z.coerce.number().int().positive().default(2_000_000),
  JD_FETCH_USER_AGENT: z
    .string()
    .min(1)
    .default(
      "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0 Rotom/0.1",
    ),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    // Fail fast and loud — a misconfigured service must not start.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/**
 * Validated, immutable environment configuration. Importing this module has the
 * side effect of validating the environment; any failure aborts startup.
 */
export const env: Readonly<Env> = Object.freeze(loadEnv());

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
