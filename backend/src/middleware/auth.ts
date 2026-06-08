import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { UnauthorizedError } from "../lib/errors.js";
import { verifyToken } from "../modules/auth/auth.service.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const BEARER_PREFIX = "Bearer ";

/**
 * Requires a valid `Authorization: Bearer <token>` header. On success attaches
 * `req.userId`; otherwise responds 401. Token comparison is constant-time (see
 * auth.service).
 */
export const requireAuth = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError("Missing or malformed Authorization header");
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    const result = await verifyToken(token);
    if (!result) {
      throw new UnauthorizedError("Invalid API token");
    }
    req.userId = result.userId;
    next();
  },
);
