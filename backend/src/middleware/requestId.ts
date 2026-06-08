import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "../lib/logger.js";
import { logger } from "../lib/logger.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
    }
  }
}

/**
 * Assigns a request id (honoring an inbound `x-request-id`) and attaches a
 * child logger bound to it, so every log line within a request is correlatable.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const id = incoming && incoming.length <= 200 ? incoming : randomUUID();
  req.id = id;
  req.log = logger.child({ requestId: id });
  res.setHeader("x-request-id", id);
  next();
}
