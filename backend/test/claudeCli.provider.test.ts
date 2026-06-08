import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn().mockResolvedValue("/tmp/rotom-claude-test"),
  rm: vi.fn().mockResolvedValue(undefined),
}));

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args) as unknown,
}));

// Imported after mocks are registered.
const { ClaudeCliProvider } = await import("../src/modules/generation/claudeCli.provider.js");
const { TimeoutError, UpstreamError } = await import("../src/lib/errors.js");

interface FakeChildOptions {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  emitError?: NodeJS.ErrnoException;
  /** When true, never emits on its own — only the timeout/kill path resolves it. */
  silent?: boolean;
}

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(options: FakeChildOptions): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // SIGKILL on a real process triggers "close"; mirror that so timeouts resolve.
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", null));
  });

  // The provider attaches all listeners and *then* calls stdin.end(). Emitting
  // from end() guarantees our events fire after listeners are attached — for
  // every spawn, including the retry path where children are pre-constructed.
  child.stdin = {
    end: vi.fn(() => {
      if (options.silent) {
        return;
      }
      queueMicrotask(() => {
        if (options.emitError) {
          child.emit("error", options.emitError);
          return;
        }
        if (options.stdout) {
          child.stdout.emit("data", Buffer.from(options.stdout, "utf8"));
        }
        if (options.stderr) {
          child.stderr.emit("data", Buffer.from(options.stderr, "utf8"));
        }
        child.emit("close", options.code ?? 0);
      });
    }),
  };
  return child;
}

function envelope(fields: Record<string, unknown>): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, ...fields });
}

const provider = new ClaudeCliProvider();

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ClaudeCliProvider.generate", () => {
  it("returns text on a successful run", async () => {
    spawnMock.mockReturnValue(
      makeFakeChild({ stdout: envelope({ result: "hello world", total_cost_usd: 0.002 }) }),
    );
    const result = await provider.generate({ systemContract: "c", userPrompt: "p" });
    expect(result.text).toBe("hello world");
    expect(result.costUsd).toBe(0.002);
  });

  it("pipes the prompt via stdin, not argv", async () => {
    const child = makeFakeChild({ stdout: envelope({ result: "ok" }) });
    spawnMock.mockReturnValue(child);
    await provider.generate({ systemContract: "c", userPrompt: "MY-PROMPT" });
    expect(child.stdin.end).toHaveBeenCalledWith("MY-PROMPT", "utf8");
    const args = spawnMock.mock.calls[0]![1] as string[];
    expect(args).not.toContain("MY-PROMPT");
  });

  it("builds hardened, tool-less args", async () => {
    spawnMock.mockReturnValue(makeFakeChild({ stdout: envelope({ result: "ok" }) }));
    await provider.generate({
      systemContract: "contract-text",
      userPrompt: "p",
      jsonSchema: { type: "object" },
    });
    const args = spawnMock.mock.calls[0]![1] as string[];
    expect(args).toEqual(
      expect.arrayContaining([
        "-p",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--tools",
        "--output-format",
        "json",
        "--system-prompt",
        "contract-text",
        "--json-schema",
      ]),
    );
    // The token right after --tools must be the empty string (disable all tools).
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    // --bare is intentionally absent: it forces API-key auth and never reads the
    // logged-in subscription token.
    expect(args).not.toContain("--bare");
  });

  it("parses structured output from the result body and validates with Zod", async () => {
    spawnMock.mockReturnValue(
      makeFakeChild({ stdout: envelope({ result: '{"ok": true}' }) }),
    );
    const result = await provider.generate({
      systemContract: "c",
      userPrompt: "p",
      outputSchema: z.object({ ok: z.literal(true) }),
    });
    expect(result.structured).toEqual({ ok: true });
  });

  it("prefers the structured_output envelope field when present", async () => {
    spawnMock.mockReturnValue(
      makeFakeChild({
        stdout: envelope({ result: "ignored", structured_output: { ok: true } }),
      }),
    );
    const result = await provider.generate({
      systemContract: "c",
      userPrompt: "p",
      outputSchema: z.object({ ok: z.literal(true) }),
    });
    expect(result.structured).toEqual({ ok: true });
  });

  it("strips markdown fences before parsing structured output", async () => {
    spawnMock.mockReturnValue(
      makeFakeChild({ stdout: envelope({ result: '```json\n{"ok": true}\n```' }) }),
    );
    const result = await provider.generate({
      systemContract: "c",
      userPrompt: "p",
      outputSchema: z.object({ ok: z.literal(true) }),
    });
    expect(result.structured).toEqual({ ok: true });
  });

  it("retries once on schema-validation failure, then throws UpstreamError", async () => {
    spawnMock
      .mockReturnValueOnce(makeFakeChild({ stdout: envelope({ result: '{"ok": false}' }) }))
      .mockReturnValueOnce(makeFakeChild({ stdout: envelope({ result: '{"ok": false}' }) }));
    await expect(
      provider.generate({
        systemContract: "c",
        userPrompt: "p",
        outputSchema: z.object({ ok: z.literal(true) }),
      }),
    ).rejects.toBeInstanceOf(UpstreamError);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("throws UpstreamError when the envelope signals is_error", async () => {
    spawnMock.mockReturnValue(
      makeFakeChild({
        stdout: JSON.stringify({ type: "result", is_error: true, result: "Not logged in" }),
      }),
    );
    await expect(
      provider.generate({ systemContract: "c", userPrompt: "p" }),
    ).rejects.toThrow(/Not logged in/);
  });

  it("throws UpstreamError when the CLI binary is missing (ENOENT)", async () => {
    const err: NodeJS.ErrnoException = new Error("spawn claude ENOENT");
    err.code = "ENOENT";
    spawnMock.mockReturnValue(makeFakeChild({ emitError: err }));
    await expect(
      provider.generate({ systemContract: "c", userPrompt: "p" }),
    ).rejects.toThrow(/not found/i);
  });

  it("throws UpstreamError on unparseable output", async () => {
    spawnMock.mockReturnValue(makeFakeChild({ stdout: "not json at all", code: 0 }));
    await expect(
      provider.generate({ systemContract: "c", userPrompt: "p" }),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it("throws TimeoutError when the subprocess exceeds the deadline", async () => {
    spawnMock.mockReturnValue(makeFakeChild({ silent: true }));
    await expect(
      provider.generate({ systemContract: "c", userPrompt: "p", timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("ClaudeCliProvider.healthCheck", () => {
  it("returns model + cost on a valid probe response", async () => {
    spawnMock.mockReturnValue(
      makeFakeChild({ stdout: envelope({ result: '{"ok": true}', total_cost_usd: 0.0001 }) }),
    );
    const result = await provider.healthCheck();
    expect(result.costUsd).toBe(0.0001);
    expect(typeof result.model).toBe("string");
  });
});
