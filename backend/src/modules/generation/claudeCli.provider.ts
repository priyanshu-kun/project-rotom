import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { TimeoutError, UpstreamError } from "../../lib/errors.js";
import { buildSystemContract } from "./prompts.js";
import { healthProbeJsonSchema, healthProbeSchema } from "./generation.schema.js";
import type { GenerationProvider, GenerationRequest, GenerationResult } from "./provider.js";

/**
 * The JSON envelope emitted by `claude -p --output-format json`. Note that a
 * failed run may exit 0 yet set `is_error: true` (e.g. "Not logged in"), so the
 * flag — not the exit code alone — is the source of truth for success.
 */
interface ClaudeEnvelope {
  type: string;
  subtype?: string;
  is_error: boolean;
  result: string;
  total_cost_usd?: number;
  // Possible structured-output carriers depending on CLI version.
  structured_output?: unknown;
  structuredOutput?: unknown;
}

interface RawRun {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

const MAX_STDOUT_BYTES = 10 * 1024 * 1024; // 10 MB guard against runaway output.

/**
 * Spawns the claude CLI as a sandboxed, non-interactive, pure-text generator.
 *
 * Hardening:
 *  - args passed as an array (no shell) — no command injection;
 *  - prompt piped via stdin (not argv) — no length limit, no leakage in `ps`;
 *  - `--tools ""` disables every tool → cannot read files or run commands;
 *  - `--bare` + `--no-session-persistence` → no CLAUDE.md/hooks/keychain, no
 *    session written to disk;
 *  - runs in a throwaway temp cwd → no project context;
 *  - minimal env (PATH/HOME + ANTHROPIC_API_KEY only);
 *  - hard SIGKILL timeout.
 */
function runClaude(args: string[], stdin: string, timeoutMs: number): Promise<RawRun> {
  return new Promise<RawRun>((resolve, reject) => {
    let cwd: string | undefined;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;

    void mkdtemp(path.join(os.tmpdir(), "rotom-claude-"))
      .then((dir) => {
        cwd = dir;
        const child = spawn(env.CLAUDE_BIN, args, {
          cwd,
          // Deliberately minimal environment surface.
          env: {
            PATH: process.env.PATH ?? "",
            HOME: process.env.HOME ?? os.homedir(),
            ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
            CI: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
        });

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeoutMs);
        timer.unref();

        const cleanup = (): void => {
          clearTimeout(timer);
          if (cwd) {
            void rm(cwd, { recursive: true, force: true }).catch((err: unknown) => {
              logger.warn({ err, cwd }, "Failed to clean up claude temp dir");
            });
          }
        };

        child.stdout.on("data", (chunk: Buffer) => {
          stdoutBytes += chunk.length;
          if (stdoutBytes > MAX_STDOUT_BYTES) {
            child.kill("SIGKILL");
            return;
          }
          stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });

        child.on("error", (err: NodeJS.ErrnoException) => {
          cleanup();
          if (err.code === "ENOENT") {
            reject(
              new UpstreamError(
                `Claude CLI not found (CLAUDE_BIN="${env.CLAUDE_BIN}"). Is it installed and on PATH?`,
              ),
            );
            return;
          }
          reject(new UpstreamError(`Failed to spawn Claude CLI: ${err.message}`));
        });

        child.on("close", (code) => {
          cleanup();
          resolve({ stdout, stderr, exitCode: code, timedOut });
        });

        // Feed the prompt and close stdin.
        child.stdin.end(stdin, "utf8");
      })
      .catch((err: unknown) => {
        reject(new UpstreamError(`Failed to prepare Claude CLI sandbox: ${String(err)}`));
      });
  });
}

function parseEnvelope(run: RawRun): ClaudeEnvelope {
  if (run.timedOut) {
    throw new TimeoutError("Claude generation timed out");
  }
  let envelope: ClaudeEnvelope;
  try {
    envelope = JSON.parse(run.stdout) as ClaudeEnvelope;
  } catch {
    throw new UpstreamError(
      `Claude CLI returned unparseable output (exit ${String(run.exitCode)}): ${
        run.stderr.slice(0, 500) || run.stdout.slice(0, 500)
      }`,
    );
  }
  if (envelope.is_error || run.exitCode !== 0) {
    throw new UpstreamError(`Claude generation failed: ${envelope.result || run.stderr}`);
  }
  return envelope;
}

/** Strip markdown code fences a model may wrap JSON in, then return inner text. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenceMatch ? fenceMatch[1]!.trim() : trimmed;
}

function extractStructured(envelope: ClaudeEnvelope): unknown {
  if (envelope.structured_output !== undefined) {
    return envelope.structured_output;
  }
  if (envelope.structuredOutput !== undefined) {
    return envelope.structuredOutput;
  }
  return JSON.parse(stripFences(envelope.result));
}

export class ClaudeCliProvider implements GenerationProvider {
  private buildArgs(request: GenerationRequest): string[] {
    const args: string[] = [
      "-p",
      "--bare",
      "--no-session-persistence",
      "--tools",
      "", // disable all tools: pure text generator
      "--output-format",
      "json",
      "--model",
      request.model ?? env.CLAUDE_MODEL,
      "--max-budget-usd",
      String(env.CLAUDE_MAX_BUDGET_USD),
      "--append-system-prompt",
      request.systemContract,
    ];
    if (request.jsonSchema) {
      args.push("--json-schema", JSON.stringify(request.jsonSchema));
    }
    return args;
  }

  async generate<T = unknown>(request: GenerationRequest): Promise<GenerationResult<T>> {
    const model = request.model ?? env.CLAUDE_MODEL;
    const timeoutMs = request.timeoutMs ?? env.CLAUDE_TIMEOUT_MS;
    const args = this.buildArgs(request);

    // One retry, but only for structured parse/validation failures — never for
    // timeouts or upstream/auth errors (retrying those just wastes budget).
    const maxAttempts = request.outputSchema ? 2 : 1;
    let lastValidationError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const run = await runClaude(args, request.userPrompt, timeoutMs);
      const envelope = parseEnvelope(run);

      const result: GenerationResult<T> = {
        text: envelope.result,
        model,
        ...(envelope.total_cost_usd !== undefined ? { costUsd: envelope.total_cost_usd } : {}),
      };

      if (!request.outputSchema) {
        return result;
      }

      try {
        const candidate = extractStructured(envelope);
        result.structured = request.outputSchema.parse(candidate) as T;
        return result;
      } catch (error) {
        lastValidationError = error;
        logger.warn(
          { attempt, maxAttempts },
          "Claude structured output failed validation; retrying if attempts remain",
        );
      }
    }

    throw new UpstreamError(
      `Claude returned output that failed schema validation after ${maxAttempts} attempt(s): ${String(
        lastValidationError,
      )}`,
    );
  }

  async healthCheck(): Promise<{ model: string; costUsd?: number }> {
    const result = await this.generate({
      systemContract: buildSystemContract({ jsonOnly: true }),
      userPrompt: 'Reply with the JSON object {"ok": true} and nothing else.',
      jsonSchema: healthProbeJsonSchema,
      outputSchema: healthProbeSchema,
      // A health probe should be quick; cap it well under the default.
      timeoutMs: Math.min(env.CLAUDE_TIMEOUT_MS, 30_000),
    });
    return {
      model: result.model,
      ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
    };
  }
}

/** Default singleton provider used by routes. */
export const claudeCliProvider: GenerationProvider = new ClaudeCliProvider();
