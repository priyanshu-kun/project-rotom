/**
 * Typed application errors. Each carries an HTTP status and a client-safe
 * message; the central error middleware uses `expose` to decide whether the
 * message may be returned to the caller (true) or replaced with a generic 500.
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  /** Whether `message` is safe to return to the client. */
  readonly expose: boolean = true;
  /** Optional structured detail (e.g. Zod field issues). */
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    if (details !== undefined) {
      this.details = details;
    }
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  readonly statusCode = 400;
  readonly code = "BAD_REQUEST";
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = "VALIDATION_ERROR";
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  readonly code = "UNAUTHORIZED";
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = "NOT_FOUND";
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = "CONFLICT";
}

/**
 * Upstream/dependency failure (DB, Redis, Claude CLI). The internal message is
 * logged but not exposed to clients.
 */
export class UpstreamError extends AppError {
  readonly statusCode = 502;
  readonly code = "UPSTREAM_ERROR";
  override readonly expose = false;
}

/** Subprocess/generation timed out. */
export class TimeoutError extends AppError {
  readonly statusCode = 504;
  readonly code = "TIMEOUT";
  override readonly expose = false;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
