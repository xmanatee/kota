import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "./types.js";

const mockQuery = vi.fn();
const mockSpawnSync = vi.fn();

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

import {
  buildQueryOptions,
  detectLocalClaudeCodeExecutable,
  executeWithAgentSDK,
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
    const result = await executeWithAgentSDK("test prompt", {}, writer);

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
    const result = await executeWithAgentSDK("test prompt", {}, writer);

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

    const result = await executeWithAgentSDK("test prompt", {}, makeWriter());

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
      maxBudgetUsd: 1.5,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: "extra",
      },
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
        maxBudgetUsd: 1.5,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: "extra",
        },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: ["Read", "Edit"],
        disallowedTools: ["Bash"],
        persistSession: false,
        settingSources: ["project"],
        enableFileCheckpointing: true,
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        abortController: undefined,
        effort: undefined,
      },
    });
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
    await executeWithAgentSDK("task", { verbose: true }, makeWriter());

    expect(stderrSpy).toHaveBeenCalledWith("[agent-sdk] Running tests\n");
    stderrSpy.mockRestore();
  });

  it("buildQueryOptions defaults to bypassPermissions", () => {
    mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });

    expect(buildQueryOptions({ cwd: "/tmp/project" })).toMatchObject({
      cwd: "/tmp/project",
      maxTurns: undefined,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: undefined,
    });
  });
});
