import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps an async Express handler so rejected promises are forwarded to the
 * central error middleware. Express 4 does not await handlers, so without this
 * an async throw becomes an unhandled rejection rather than a 500 response.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
