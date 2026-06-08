import { pino, type LoggerOptions } from "pino";
import { env, isProduction } from "../config/env.js";

/**
 * Application logger. PII and secrets are redacted at the logger level so a
 * stray `logger.info({ profile })` can never leak personal data or tokens.
 */
const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "authorization",
      "token",
      "apiToken",
      "*.token_hash",
      "tokenHash",
      "password",
      // Profile PII — never log decrypted personal fields.
      "*.personal",
      "personal",
      "*.email",
      "*.phone",
      "ANTHROPIC_API_KEY",
      "DATA_ENCRYPTION_KEY",
    ],
    censor: "[REDACTED]",
  },
};

// Pretty output in dev; structured JSON in production.
if (!isProduction) {
  options.transport = {
    target: "pino-pretty",
    options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
  };
}

export const logger = pino(options);

export type Logger = typeof logger;
