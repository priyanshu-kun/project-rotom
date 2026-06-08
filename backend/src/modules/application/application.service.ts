import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import type { ApplicationStatus } from "../../db/schema.js";
import { fetchJobPostingText } from "../jd/jd.fetch.js";
import { extractStructuredJd } from "../jd/jd.service.js";
import { assertTransition } from "./statusMachine.js";
import * as repo from "./application.repo.js";
import type {
  CreateApplicationInput,
  ListQuery,
  UpdateApplicationInput,
} from "./application.schema.js";

/**
 * Create an application: resolve the JD text (pasted, else fetched from the
 * URL), structure it via the AI layer (synchronous — feeds the review step),
 * derive company/role, and persist record + JD + initial timeline event.
 * (JD-1/JD-3/JD-4, TRK-1.)
 */
export async function createApplication(userId: string, input: CreateApplicationInput) {
  let rawText: string;
  if (input.jdText) {
    rawText = input.jdText;
  } else if (input.jobUrl) {
    // fetchJobPostingText throws a typed error; on a fetch failure the client
    // is expected to retry with pasted jdText (JD-4 fallback).
    rawText = await fetchJobPostingText(input.jobUrl);
  } else {
    throw new BadRequestError("Provide either jobUrl or jdText");
  }

  const jd = await extractStructuredJd(rawText);

  const company = input.company ?? jd.company ?? "Unknown company";
  const role = input.role ?? jd.title ?? "Unknown role";

  return repo.createWithJd(userId, { company, role, jobUrl: input.jobUrl ?? null }, jd);
}

export async function listApplications(userId: string, filters: ListQuery) {
  return repo.list(userId, filters);
}

export async function getApplication(userId: string, id: string) {
  const detail = await repo.getDetail(userId, id);
  if (!detail) {
    throw new NotFoundError("Application not found");
  }
  return detail;
}

/** Update a status with state-machine validation (TRK-3, LC-2, LC-3). */
export async function updateStatus(
  userId: string,
  id: string,
  toStatus: ApplicationStatus,
  note: string | undefined,
) {
  const application = await repo.findById(userId, id);
  if (!application) {
    throw new NotFoundError("Application not found");
  }
  assertTransition(application.status, toStatus); // throws 409 on illegal transition
  const stampDateApplied = toStatus === "Applied" && application.dateApplied === null;
  return repo.applyStatusTransition(id, application.status, toStatus, note, stampDateApplied);
}

export async function updateApplication(userId: string, id: string, fields: UpdateApplicationInput) {
  const updated = await repo.updateFields(userId, id, fields);
  if (!updated) {
    throw new NotFoundError("Application not found");
  }
  return updated;
}

export async function deleteApplication(userId: string, id: string): Promise<void> {
  const deleted = await repo.deleteById(userId, id);
  if (!deleted) {
    throw new NotFoundError("Application not found");
  }
}
