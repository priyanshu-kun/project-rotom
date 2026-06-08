import { describe, expect, it } from "vitest";
import {
  ALL_STATUSES,
  allowedTransitions,
  assertTransition,
  canTransition,
  isTerminal,
} from "../src/modules/application/statusMachine.js";
import { ConflictError } from "../src/lib/errors.js";

describe("application status machine", () => {
  it("covers all 13 PRD statuses", () => {
    expect(ALL_STATUSES).toHaveLength(13);
  });

  it("allows sensible forward transitions", () => {
    expect(canTransition("Saved", "Applied")).toBe(true);
    expect(canTransition("Applied", "Under Review")).toBe(true);
    expect(canTransition("Offer Received", "Accepted")).toBe(true);
    expect(canTransition("Technical Interview", "Final Interview")).toBe(true);
  });

  it("blocks illegal transitions", () => {
    expect(canTransition("Accepted", "Saved")).toBe(false);
    expect(canTransition("Saved", "Offer Received")).toBe(false);
    expect(canTransition("Applied", "Technical Interview")).toBe(false);
  });

  it("treats same-status as a non-transition", () => {
    expect(canTransition("Applied", "Applied")).toBe(false);
  });

  it("marks terminal states with no outgoing edges", () => {
    expect(isTerminal("Accepted")).toBe(true);
    expect(isTerminal("Rejected")).toBe(true);
    expect(isTerminal("Withdrawn")).toBe(true);
    expect(isTerminal("Applied")).toBe(false);
    expect(allowedTransitions("Accepted")).toHaveLength(0);
  });

  it("allows Withdrawn from any non-terminal state", () => {
    for (const status of ALL_STATUSES) {
      if (!isTerminal(status)) {
        expect(canTransition(status, "Withdrawn")).toBe(true);
      }
    }
  });

  it("assertTransition throws ConflictError on illegal transition", () => {
    expect(() => assertTransition("Accepted", "Saved")).toThrow(ConflictError);
    expect(() => assertTransition("Saved", "Applied")).not.toThrow();
  });
});
