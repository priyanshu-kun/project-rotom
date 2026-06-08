import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { isAppError, ValidationError } from "../lib/errors.js";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

/**
 * Central error handler. Translates known error types into safe JSON responses
 * and collapses everything else into an opaque 500. Always logs the full error
 * server-side with the request id for correlation.
 *
 * Must be registered last, after all routes.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction, // Express requires the 4-arg signature to detect an error handler.
): void {
  // Normalize Zod errors that escaped a route into a ValidationError.
  const error =
    err instanceof ZodError
      ? new ValidationError("Request validation failed", err.flatten())
      : err;

  if (isAppError(error)) {
    if (error.statusCode >= 500) {
      req.log.error({ err: error, code: error.code }, "Request failed");
    } else {
      req.log.warn({ code: error.code }, error.message);
    }

    const body: ErrorBody = {
      error: {
        code: error.code,
        message: error.expose ? error.message : "An internal error occurred",
        requestId: req.id,
      },
    };
    if (error.expose && error.details !== undefined) {
      body.error.details = error.details;
    }
    res.status(error.statusCode).json(body);
    return;
  }

  // Unknown error — never leak internals.
  req.log.error({ err: error }, "Unhandled error");
  const body: ErrorBody = {
    error: {
      code: "INTERNAL_ERROR",
      message: "An internal error occurred",
      requestId: req.id,
    },
  };
  res.status(500).json(body);
}

/** 404 fallback for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route not found: ${req.method} ${req.path}`,
      requestId: req.id,
    },
  });
}
