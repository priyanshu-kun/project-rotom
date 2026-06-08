import type { Request } from "express";
import { BadRequestError } from "./errors.js";

/**
 * Read a required route parameter. Express types `req.params[name]` as
 * `string | undefined` under `noUncheckedIndexedAccess`; a matched route
 * guarantees presence, but this narrows the type and fails loudly if a route is
 * ever mounted without the expected segment.
 */
export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (value === undefined || value === "") {
    throw new BadRequestError(`Missing route parameter: ${name}`);
  }
  return value;
}
