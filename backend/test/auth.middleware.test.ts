import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyToken = vi.fn();
vi.mock("../src/modules/auth/auth.service.js", () => ({ verifyToken }));

const { requireAuth } = await import("../src/middleware/auth.js");
const { UnauthorizedError } = await import("../src/lib/errors.js");

/** Drive the asyncHandler-wrapped middleware and resolve when next() fires. */
function run(headerValue?: string): Promise<{ err?: unknown; userId?: string | undefined }> {
  const req = {
    header: (name: string) =>
      name.toLowerCase() === "authorization" ? headerValue : undefined,
  } as unknown as Request & { userId?: string };

  return new Promise((resolve) => {
    const next: NextFunction = (err?: unknown) => resolve({ err, userId: req.userId });
    requireAuth(req, {} as Response, next);
  });
}

beforeEach(() => {
  verifyToken.mockReset();
});

describe("requireAuth", () => {
  it("rejects a missing Authorization header", async () => {
    const { err } = await run(undefined);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer scheme", async () => {
    const { err } = await run("Basic abc123");
    expect(err).toBeInstanceOf(UnauthorizedError);
  });

  it("rejects an invalid token", async () => {
    verifyToken.mockResolvedValue(null);
    const { err } = await run("Bearer wrong-token");
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(verifyToken).toHaveBeenCalledWith("wrong-token");
  });

  it("passes and sets req.userId on a valid token", async () => {
    verifyToken.mockResolvedValue({ userId: "user-1" });
    const { err, userId } = await run("Bearer good-token");
    expect(err).toBeUndefined();
    expect(userId).toBe("user-1");
  });
});
