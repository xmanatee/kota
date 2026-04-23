import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "./types.js";

const mockQuery = vi.fn();
const mockSpawn = vi.fn();
const mockSpawnSync = vi.fn();

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

import {
  createDaemonHostControlGuard,
  isDaemonHostControlCommand,
} from "#core/agent-harness/guards.js";
import {
  buildQueryOptions,
  detectLocalClaudeCodeExecutable,
  executeWithAgentSDK,
  normalizePermissionResult,
  SDK_ABORT_FORCE_KILL_MS,
  spawnClaudeCodeProcessWithAbortKill,
} from "./executor.js";

function makeIterable(messages: SDKMessage[]): AsyncIterable<SDKMessage> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message;
    },
  };
}

function makeWriter() {
  const chunks: string[] = [];
  return {
    write(text: string) {
      chunks.push(text);
      return true;
    },
    get text() {
      return chunks.join("");
    },
  };
}

describe("agent-sdk executor", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockSpawn.mockReset();
    mockSpawnSync.mockReset();
    mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });
    delete process.env.CLAUDE_CODE_EXECUTABLE;
  });

  it("streams assistant text and returns final result metadata", async () => {
    mockQuery.mockReturnValue(
      makeIterable([
        { type: "system", subtype: "init", session_id: "sess-123" },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello " }] },
        },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "world" }] },
        },
        {
          type: "result",
          result: "Final answer",
          num_turns: 2,
          total_cost_usd: 0.12,
          subtype: "success",
        },
      ]),
    );

    const writer = makeWriter();
    const result = await executeWithAgentSDK("test prompt", { effort: "xhigh" }, writer);

    expect(writer.text).toBe("Hello world");
    expect(result.text).toBe("Final answer");
    expect(result.streamedText).toBe("Hello world");
    expect(result.sessionId).toBe("sess-123");
    expect(result.turns).toBe(2);
    expect(result.totalCostUsd).toBe(0.12);
    expect(result.subtype).toBe("success");
    expect(result.isError).toBe(false);
  });

  it("supports top-level content blocks when present", async () => {
    mockQuery.mockReturnValue(
      makeIterable([
        {
          type: "assistant",
          content: [
            { type: "text", text: "one " },
            { type: "tool_use" },
            { type: "text", text: "two" },
          ],
        },
      ]),
    );

    const writer = makeWriter();
    const result = await executeWithAgentSDK("test prompt", { effort: "xhigh" }, writer);

    expect(writer.text).toBe("one two");
    expect(result.text).toBe("one two");
    expect(result.turns).toBe(1);
    expect(result.isError).toBe(false);
  });

  it("marks error result subtypes as errors", async () => {
    mockQuery.mockReturnValue(
      makeIterable([
        {
          type: "result",
          result: "Stopped at turn limit",
          subtype: "error_max_turns",
          is_error: true,
        },
      ]),
    );

    const result = await executeWithAgentSDK("test prompt", { effort: "xhigh" }, makeWriter());

    expect(result.subtype).toBe("error_max_turns");
    expect(result.isError).toBe(true);
  });

  it("passes strict SDK options through to query()", async () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "/usr/local/bin/claude\n" });
    mockQuery.mockReturnValue(
      makeIterable([{ type: "result", result: "done", subtype: "success" }]),
    );

    await executeWithAgentSDK("my task", {
      model: "claude-sonnet-4-6",
      cwd: "/tmp/project",
      maxTurns: 12,
      effort: "xhigh",
      systemPrompt: "portable system text",
      permissionMode: "bypassPermissions",
      allowedTools: ["Read", "Edit"],
      disallowedTools: ["Bash"],
      persistSession: false,
      settingSources: ["project"],
      enableFileCheckpointing: true,
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith({
      prompt: "my task",
      options: {
        model: "claude-sonnet-4-6",
        cwd: "/tmp/project",
        maxTurns: 12,
        systemPrompt: "portable system text",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: ["Read", "Edit"],
        disallowedTools: ["Bash"],
        mcpServers: undefined,
        persistSession: false,
        settingSources: ["project"],
        enableFileCheckpointing: true,
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        abortController: undefined,
        effort: "xhigh",
        thinking: undefined,
        spawnClaudeCodeProcess: expect.any(Function),
        canUseTool: undefined,
      },
    });
  });

  it("identifies daemon-host control commands", () => {
    expect(isDaemonHostControlCommand("pnpm kota daemon stop", 7315)).toBe(true);
    expect(isDaemonHostControlCommand("node dist/cli.js daemon", 7315)).toBe(true);
    expect(isDaemonHostControlCommand("kill -TERM 7315", 7315)).toBe(true);
    expect(isDaemonHostControlCommand("kill -s TERM 7315", 7315)).toBe(true);
    expect(isDaemonHostControlCommand("pnpm kota workflow abort", 7315)).toBe(true);
    expect(isDaemonHostControlCommand("pnpm kota task move example done", 7315)).toBe(false);
    expect(isDaemonHostControlCommand("pnpm build", 7315)).toBe(false);
  });

  it("denies Bash daemon-host control commands through SDK permissions", async () => {
    const guard = createDaemonHostControlGuard(7315);
    const options = { signal: new AbortController().signal, toolUseID: "tool-1" };

    await expect(
      guard("Read", { file_path: "src/index.ts" }, options),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: { file_path: "src/index.ts" },
    });
    await expect(
      guard("Bash", { command: "pnpm kota task move example done" }, options),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "pnpm kota task move example done" },
    });
    const denied = await guard(
      "Bash",
      { command: "pnpm kota daemon stop" },
      options,
    );
    expect(denied).toMatchObject({ behavior: "deny" });
    expect(denied).not.toHaveProperty("interrupt");
  });

  it("detects a locally installed claude executable", () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 0,
      stdout: "/Users/test/.local/bin/claude\n",
    });

    expect(detectLocalClaudeCodeExecutable()).toBe(
      "/Users/test/.local/bin/claude",
    );
  });

  it("prefers CLAUDE_CODE_EXECUTABLE over PATH lookup", () => {
    process.env.CLAUDE_CODE_EXECUTABLE = "/custom/claude";

    expect(detectLocalClaudeCodeExecutable()).toBe("/custom/claude");
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("writes verbose status messages to stderr", async () => {
    mockQuery.mockReturnValue(
      makeIterable([
        {
          type: "system",
          subtype: "task_started",
          description: "Running tests",
        },
        { type: "result", result: "done", subtype: "success" },
      ]),
    );

    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await executeWithAgentSDK("task", { verbose: true, effort: "xhigh" }, makeWriter());

    expect(stderrSpy).toHaveBeenCalledWith("[agent-sdk] Running tests\n");
    stderrSpy.mockRestore();
  });

  it("buildQueryOptions defaults to bypassPermissions", () => {
    mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });

    expect(buildQueryOptions({ cwd: "/tmp/project", effort: "xhigh" })).toMatchObject({
      cwd: "/tmp/project",
      maxTurns: undefined,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: undefined,
    });
  });

  it("runs guarded calls through SDK permission callbacks instead of bypass mode", () => {
    const canUseTool = vi.fn(async () => ({ behavior: "allow" as const }));

    const options = buildQueryOptions({
      cwd: "/tmp/project",
      effort: "xhigh",
      permissionMode: "bypassPermissions",
      canUseTool,
    });

    expect(options).toMatchObject({
      permissionMode: "default",
      allowDangerouslySkipPermissions: false,
      canUseTool: expect.any(Function),
    });
  });

  it("normalizes allow decisions to the SDK runtime permission contract", async () => {
    const input = { command: "pnpm build" };
    const canUseTool = vi.fn(async () => ({ behavior: "allow" as const }));
    const options = buildQueryOptions({
      cwd: "/tmp/project",
      effort: "xhigh",
      permissionMode: "bypassPermissions",
      canUseTool,
    });

    await expect(
      options.canUseTool?.("Bash", input, {
        signal: new AbortController().signal,
        toolUseID: "tool-1",
      }),
    ).resolves.toEqual({
      behavior: "allow",
      updatedInput: input,
    });
  });

  it("preserves explicit permission input updates", () => {
    expect(
      normalizePermissionResult(
        { behavior: "allow", updatedInput: { command: "echo changed" } },
        { command: "echo original" },
      ),
    ).toEqual({ behavior: "allow", updatedInput: { command: "echo changed" } });
  });

  it("buildQueryOptions forwards MCP server config", () => {
    const mcpServers = {
      local: { type: "stdio" as const, command: "node", args: ["server.js"] },
    };

    expect(buildQueryOptions({ cwd: "/tmp/project", effort: "xhigh", mcpServers })).toMatchObject({
      mcpServers,
    });
  });

  it("throws when abort signal fires between messages", async () => {
    const abortController = new AbortController();
    const timeoutError = new Error("Step timed out after 1000ms");

    mockQuery.mockReturnValue(
      makeIterable([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "first" }] },
        },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "second" }] },
        },
        {
          type: "result",
          result: "done",
          subtype: "success",
        },
      ]),
    );

    const writer = makeWriter();
    const onMessage = vi.fn(async () => {
      if (onMessage.mock.calls.length === 1) {
        abortController.abort(timeoutError);
      }
    });

    await expect(
      executeWithAgentSDK("test", { abortController, onMessage, effort: "xhigh" }, writer),
    ).rejects.toThrow("Step timed out after 1000ms");

    expect(writer.text).toBe("first");
  });

  it("throws immediately when abort signal is already set", async () => {
    const abortController = new AbortController();
    const reason = new Error("Already aborted");
    abortController.abort(reason);

    mockQuery.mockReturnValue(
      makeIterable([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "should not appear" }] },
        },
        { type: "result", result: "done", subtype: "success" },
      ]),
    );

    const writer = makeWriter();
    await expect(
      executeWithAgentSDK("test", { abortController, effort: "xhigh" }, writer),
    ).rejects.toThrow("Already aborted");

    expect(writer.text).toBe("");
  });

  it("force-kills a spawned Claude process when abort does not exit cleanly", () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const child = Object.assign(new EventEmitter(), {
      stdin: {},
      stdout: {},
      stderr: null,
      killed: false,
      exitCode: null as number | null,
      kill: vi.fn(),
    });
    mockSpawn.mockReturnValue(child);

    const spawned = spawnClaudeCodeProcessWithAbortKill({
      command: "claude",
      args: ["--output-format", "stream-json"],
      cwd: "/tmp/project",
      env: {},
      signal: abortController.signal,
    });

    abortController.abort(new Error("stop"));
    vi.advanceTimersByTime(SDK_ABORT_FORCE_KILL_MS);

    expect(spawned.kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
  });
});
