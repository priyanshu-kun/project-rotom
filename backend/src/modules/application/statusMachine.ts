import { APPLICATION_STATUSES, type ApplicationStatus } from "../../db/schema.js";
import { ConflictError } from "../../lib/errors.js";

/**
 * Allowed status transitions for an application (PRD LC-1 / LC-3).
 *
 * The graph encodes the realistic recruiting funnel: forward progression
 * through interview stages, terminal states that cannot be re-opened, and a
 * universally reachable `Withdrawn`. Terminal states (`Accepted`, `Rejected`,
 * `Withdrawn`) have no outgoing transitions, so e.g. `Accepted → Saved` is
 * rejected.
 */
const TRANSITIONS: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  Saved: ["Applying", "Applied", "Withdrawn"],
  Applying: ["Applied", "Saved", "Withdrawn"],
  Applied: ["Under Review", "Assessment Received", "Recruiter Contacted", "Rejected", "Withdrawn"],
  "Under Review": [
    "Assessment Received",
    "Recruiter Contacted",
    "Interview Scheduled",
    "Rejected",
    "Withdrawn",
  ],
  "Assessment Received": ["Recruiter Contacted", "Interview Scheduled", "Rejected", "Withdrawn"],
  "Recruiter Contacted": ["Interview Scheduled", "Rejected", "Withdrawn"],
  "Interview Scheduled": ["Technical Interview", "Final Interview", "Rejected", "Withdrawn"],
  "Technical Interview": ["Final Interview", "Offer Received", "Rejected", "Withdrawn"],
  "Final Interview": ["Offer Received", "Rejected", "Withdrawn"],
  "Offer Received": ["Accepted", "Rejected", "Withdrawn"],
  // Terminal states.
  Rejected: [],
  Accepted: [],
  Withdrawn: [],
};

export const ALL_STATUSES: readonly ApplicationStatus[] = APPLICATION_STATUSES;

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) {
    return false;
  }
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: ApplicationStatus): readonly ApplicationStatus[] {
  return TRANSITIONS[from];
}

export function isTerminal(status: ApplicationStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * Assert a transition is legal, throwing a 409 ConflictError otherwise.
 * Consumed by Phase 1 application/tracking routes.
 */
export function assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictError(
      `Illegal status transition: "${from}" → "${to}". Allowed: ${
        allowedTransitions(from).join(", ") || "(none — terminal state)"
      }`,
    );
  }
}
