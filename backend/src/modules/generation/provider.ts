import type { ZodType } from "zod";

/**
 * A generation request. `systemContract` carries the non-fabrication contract
 * and is appended to the model's system prompt; `userPrompt` carries the
 * grounded task (profile + JD facts). `outputSchema`, when present, requests
 * machine-parseable JSON validated against the schema.
 */
export interface GenerationRequest {
  systemContract: string;
  userPrompt: string;
  /** Optional JSON Schema (as a plain object) handed to the provider for structured output. */
  jsonSchema?: Record<string, unknown>;
  /** Optional Zod schema used to validate/parse the returned structured output. */
  outputSchema?: ZodType;
  /** Per-request override of the model alias/name. */
  model?: string;
  /** Per-request override of the hard timeout (ms). */
  timeoutMs?: number;
}

export interface GenerationResult<T = unknown> {
  /** Raw text result returned by the model. */
  text: string;
  /** Parsed + validated structured output, when an output schema was supplied. */
  structured?: T;
  /** Model used for the generation. */
  model: string;
  /** Reported spend for this generation in USD, if available. */
  costUsd?: number;
}

/**
 * The AI layer boundary. Phase 0 ships a Claude Code CLI subprocess
 * implementation; a future Anthropic-SDK adapter can implement the same
 * interface without touching callers.
 *
 * Per PRD §10.3, a provider only generates role-specific content — it never
 * maps form fields, makes application decisions, or submits.
 */
export interface GenerationProvider {
  /** Generate content for a single grounded request. */
  generate<T = unknown>(request: GenerationRequest): Promise<GenerationResult<T>>;
  /** Cheap liveness/auth probe; resolves when the engine is reachable. */
  healthCheck(): Promise<{ model: string; costUsd?: number }>;
}
